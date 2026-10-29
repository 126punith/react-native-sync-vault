import { SyncVault } from '../core/SyncVault';
import type { CacheConfig, CacheResult, CacheStrategy, EndpointCacheStrategy } from '../types';

interface StoredValue<T> {
  data: T;
  /** Fresh until this time; afterwards stale (still served with stale-while-revalidate). */
  freshUntil: number;
}

export interface CacheSetOptions {
  /** TTL in seconds. */
  ttl?: number;
  tags?: string[];
  /** Endpoint pattern used to look up a per-endpoint strategy. */
  endpoint?: string;
}

export interface FetchOptions extends CacheSetOptions {
  strategy?: CacheStrategy;
}

export interface FetchResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
}

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;

/** Converts '/api/todos/*' or '/api/todos/:id' patterns to a RegExp. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\uE000')
    .replace(/\*/g, '[^/?]*')
    .replace(/\uE000/g, '.*')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/?]+');
  return new RegExp(`^${escaped}(\\?.*)?$`);
}

/** The path of a URL without origin and query, used as a cache tag for exact invalidation. */
export function pathTag(url: string): string {
  const withoutOrigin = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
  const path = withoutOrigin.split('?')[0] ?? withoutOrigin;
  return `path:${path || '/'}`;
}

/**
 * Response cache on top of the native SQLite cache (`SyncVault.cache`): TTLs, tags,
 * cache-first / network-first / stale-while-revalidate, mutation-driven invalidation,
 * and LRU size limits enforced natively.
 */
class CacheManager {
  private config: CacheConfig;

  constructor(config: CacheConfig = {}) {
    this.config = { enabled: true, ...config };
  }

  isEnabled(): boolean {
    return this.config.enabled !== false;
  }

  configure(config: CacheConfig): void {
    this.config = { ...this.config, ...config };
  }

  getEndpointStrategy(endpoint: string): EndpointCacheStrategy | undefined {
    const strategies = this.config.strategies ?? {};
    if (strategies[endpoint]) return strategies[endpoint];
    for (const [pattern, strategy] of Object.entries(strategies)) {
      if (patternToRegExp(pattern).test(endpoint)) return strategy;
    }
    return undefined;
  }

  private ttlSeconds(key: string, options: CacheSetOptions = {}): number {
    return options.ttl ?? this.getEndpointStrategy(options.endpoint ?? key)?.ttl ?? this.config.defaultTtl ?? DEFAULT_TTL_SECONDS;
  }

  private usesSwr(key: string, endpoint?: string): boolean {
    const strategy = this.getEndpointStrategy(endpoint ?? key);
    return strategy?.staleWhileRevalidate === true || (strategy?.strategy ?? this.config.strategy) === 'stale-while-revalidate';
  }

  async get<T = unknown>(key: string, endpoint?: string): Promise<CacheResult<T>> {
    if (!this.isEnabled()) return { hit: false };
    const entry = await SyncVault.cache.get<StoredValue<T>>(key);
    if (!entry || entry.value == null || typeof entry.value !== 'object') return { hit: false };
    const now = Date.now();
    const stale = now > entry.value.freshUntil;
    if (stale && !this.usesSwr(key, endpoint)) {
      await SyncVault.cache.delete(key);
      return { hit: false };
    }
    return { hit: true, data: entry.value.data, stale, ttl: Math.max(entry.value.freshUntil - now, 0) };
  }

  async set<T>(key: string, data: T, options: CacheSetOptions = {}): Promise<void> {
    if (!this.isEnabled()) return;
    const ttlMs = this.ttlSeconds(key, options) * 1000;
    const swr = this.usesSwr(key, options.endpoint);
    const stored: StoredValue<T> = { data, freshUntil: Date.now() + ttlMs };
    // Stale-while-revalidate entries outlive their TTL; the native LRU limit bounds them.
    await SyncVault.cache.set(key, stored, { ttlMs: swr ? 0 : ttlMs, tags: [...(options.tags ?? []), pathTag(key)] });
    await this.enforceMaxSize();
  }

  /**
   * Resolves data with the configured strategy. Network errors fall back to any cached copy
   * (including stale) so screens keep working offline.
   */
  async fetch<T>(key: string, fetcher: () => Promise<T>, options: FetchOptions = {}): Promise<FetchResult<T>> {
    const strategy = options.strategy ?? this.getEndpointStrategy(options.endpoint ?? key)?.strategy ?? this.config.strategy ?? 'network-first';
    const fromNetwork = async (): Promise<FetchResult<T>> => {
      const data = await fetcher();
      await this.set(key, data, options);
      return { data, fromCache: false, stale: false };
    };
    const cachedOrThrow = async (error: unknown): Promise<FetchResult<T>> => {
      const entry = await SyncVault.cache.get<StoredValue<T>>(key);
      if (entry?.value && typeof entry.value === 'object') {
        return { data: entry.value.data, fromCache: true, stale: Date.now() > entry.value.freshUntil };
      }
      throw error;
    };

    if (strategy === 'network-first' || !this.isEnabled()) {
      try {
        return await fromNetwork();
      } catch (error) {
        return cachedOrThrow(error);
      }
    }

    const cached = await this.get<T>(key, options.endpoint);
    if (strategy === 'cache-first') {
      if (cached.hit && !cached.stale) return { data: cached.data as T, fromCache: true, stale: false };
      try {
        return await fromNetwork();
      } catch (error) {
        return cachedOrThrow(error);
      }
    }

    // stale-while-revalidate
    if (cached.hit) {
      if (cached.stale) void fromNetwork().catch(() => undefined);
      return { data: cached.data as T, fromCache: true, stale: !!cached.stale };
    }
    return fromNetwork();
  }

  async delete(key: string): Promise<void> {
    await SyncVault.cache.delete(key);
  }

  /** Invalidates by exact path, '*' / '**' / ':param' pattern, or URL prefix. */
  async invalidate(pattern: string): Promise<number> {
    const wildcard = pattern.search(/[*:]/);
    if (wildcard === -1) {
      return SyncVault.cache.invalidate({ tags: [pathTag(pattern)] });
    }
    // Native invalidation is prefix/tag based; the pattern's literal head is the prefix.
    return SyncVault.cache.invalidate({ prefix: pattern.slice(0, wildcard) });
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    return SyncVault.cache.invalidate({ tags });
  }

  /** Applies `invalidateOnMutate` rules, e.g. { 'POST /api/todos': ['/api/todos'] }. */
  async invalidateOnMutate(method: string, url: string): Promise<void> {
    const rules = this.config.invalidateOnMutate ?? {};
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
    const targets = new Set<string>();
    for (const [rule, patterns] of Object.entries(rules)) {
      const space = rule.indexOf(' ');
      const ruleMethod = space === -1 ? '*' : rule.slice(0, space).toUpperCase();
      const rulePattern = space === -1 ? rule : rule.slice(space + 1);
      if (ruleMethod !== '*' && ruleMethod !== method.toUpperCase()) continue;
      if (patternToRegExp(rulePattern).test(path) || patternToRegExp(rulePattern).test(url)) {
        patterns.forEach((p) => targets.add(p));
      }
    }
    await Promise.all(Array.from(targets).map((p) => this.invalidate(p)));
  }

  async clear(): Promise<void> {
    await SyncVault.cache.clear();
  }

  async getSize(): Promise<number> {
    return (await SyncVault.cache.stats()).sizeBytes;
  }

  async stats() {
    return SyncVault.cache.stats();
  }

  /** Removes expired entries and least-recently-used entries above maxSize. */
  async enforceMaxSize(): Promise<number> {
    return SyncVault.cache.evict(this.config.maxSize ?? DEFAULT_MAX_SIZE);
  }
}

let shared: CacheManager | null = null;

/** Process-wide cache used by hooks and interceptors. */
export function getCacheManager(): CacheManager {
  if (!shared) shared = new CacheManager();
  return shared;
}

export function configureCache(config: CacheConfig): CacheManager {
  getCacheManager().configure(config);
  return getCacheManager();
}

export default CacheManager;
