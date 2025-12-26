import CacheManager from './CacheManager';
import InvalidationEngine from './InvalidationEngine';
import { CacheConfig, CacheResult, EndpointCacheStrategy } from '../types';

/**
 * Smart Cache Manager
 * Enhanced cache with per-endpoint TTL and intelligent invalidation
 */
class SmartCacheManager {
  private cacheManager: CacheManager;
  private invalidationEngine: InvalidationEngine;
  private config: CacheConfig;
  private endpointStrategies: Map<string, EndpointCacheStrategy> = new Map();

  constructor(config: CacheConfig = {}) {
    this.config = config;
    this.cacheManager = new CacheManager(config);
    this.invalidationEngine = new InvalidationEngine(this.cacheManager);

    // Register invalidation rules
    if (config.invalidateOnMutate) {
      this.invalidationEngine.registerRules(config.invalidateOnMutate);
    }

    // Store endpoint strategies
    if (config.strategies) {
      Object.entries(config.strategies).forEach(([endpoint, strategy]) => {
        this.endpointStrategies.set(endpoint, strategy);
      });
    }
  }

  /**
   * Initialize smart cache manager
   */
  async initialize(): Promise<void> {
    await this.cacheManager.initialize();
  }

  /**
   * Get cache entry with endpoint-specific strategy
   */
  async get(
    key: string,
    endpoint?: string
  ): Promise<CacheResult> {
    if (!this.config.enabled) {
      return { hit: false };
    }

    // Get endpoint strategy if provided
    const strategy = endpoint
      ? this.endpointStrategies.get(endpoint)
      : undefined;

    // Use endpoint-specific TTL or default
    const result = await this.cacheManager.get(key);

    // Apply stale-while-revalidate if configured
    if (
      result.hit &&
      strategy?.staleWhileRevalidate &&
      result.stale
    ) {
      // Return stale data but mark it
      return {
        ...result,
        stale: true,
      };
    }

    return result;
  }

  /**
   * Set cache entry with endpoint-specific TTL
   */
  async set(
    key: string,
    value: any,
    options?: {
      ttl?: number;
      tags?: string[];
      endpoint?: string;
    }
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Determine TTL: options > endpoint strategy > default
    let ttl: number | undefined = options?.ttl;

    if (!ttl && options?.endpoint) {
      const strategy = this.endpointStrategies.get(options.endpoint);
      ttl = strategy?.ttl;
    }

    if (!ttl) {
      ttl = this.config.defaultTtl;
    }

    // Convert TTL from seconds to milliseconds if needed
    // (CacheManager expects milliseconds in timestamp)
    const ttlMs = ttl && ttl < 1000000000 ? ttl * 1000 : ttl;

    await this.cacheManager.set(key, value, {
      ttl: ttlMs,
      tags: options?.tags,
    });
  }

  /**
   * Invalidate cache on mutation
   */
  async invalidateOnMutate(method: string, url: string): Promise<void> {
    await this.invalidationEngine.invalidateOnMutate(method, url);
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<void> {
    await this.cacheManager.delete(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    await this.cacheManager.clear();
  }

  /**
   * Get cache size
   */
  async getSize(): Promise<number> {
    return this.cacheManager.getSize();
  }

  /**
   * Evict expired entries
   */
  async evictExpired(): Promise<number> {
    return this.cacheManager.evictExpired();
  }

  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    await this.cacheManager.invalidateByTags(tags);
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.cacheManager.isEnabled();
  }

  /**
   * Get endpoint strategy
   */
  getEndpointStrategy(endpoint: string): EndpointCacheStrategy | undefined {
    return this.endpointStrategies.get(endpoint);
  }

  /**
   * Get underlying cache manager (for advanced usage)
   */
  getCacheManager(): CacheManager {
    return this.cacheManager;
  }
}

export default SmartCacheManager;

