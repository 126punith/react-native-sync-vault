import type {
  AuthHeadersNeededEvent,
  ConflictEvent,
  EnqueueRequest,
  NativeConfig,
  QueuedRequest,
  RequestEvent,
  Spec,
} from '../specs/NativeSyncVault';
import { getNative } from '../native';
import { DEFAULT_NATIVE_CONFIG } from './defaults';
import { hasSecureRandom, uuidv7 } from './uuid';
import type {
  AuthContext,
  BackgroundDrainOptions,
  CachedValue,
  CacheSetOptions,
  Conflict,
  ConflictResolution,
  EnqueueOptions,
  MergeFunction,
  NetworkState,
  PowerState,
  QueueCounts,
  RequestQuery,
  RequestState,
  SyncEvent,
  SyncRequest,
  SyncVaultConfig,
} from './types';

type Unsubscribe = () => void;
type NativeSubscription = { remove: () => void };

const ALL_STATES: RequestState[] = ['pending', 'inflight', 'succeeded', 'conflict', 'dead_letter'];

function parseMaybeJson(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function appendQuery(url: string, params: EnqueueOptions['queryParams']): string {
  if (!params) return url;
  const entries = Object.entries(params);
  if (entries.length === 0) return url;
  const query = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return url + (url.includes('?') ? '&' : '?') + query;
}

export function serializeBody(body: unknown, contentType?: string): { body: string | null; contentType: string | null } {
  if (body === undefined || body === null) return { body: null, contentType: contentType ?? null };
  if (typeof body === 'string') return { body, contentType: contentType ?? null };
  const isBinary =
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body);
  if (isBinary) {
    throw new Error('react-native-sync-vault: FormData, Blob, and binary bodies cannot be queued; serialize them first.');
  }
  return { body: JSON.stringify(body), contentType: contentType ?? 'application/json' };
}

function toSyncRequest(row: QueuedRequest): SyncRequest {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return { ...row, status: row.status as RequestState, metadata };
}

function toConflict(event: ConflictEvent): Conflict {
  return {
    id: event.id,
    method: event.method,
    url: event.url,
    local: parseMaybeJson(event.localBody),
    server: parseMaybeJson(event.serverBody),
    localBody: event.localBody,
    serverBody: event.serverBody,
    serverVersion: event.serverVersion,
    httpStatus: event.httpStatus,
  };
}

/**
 * The single engine facade. Independent of React: call `SyncVault.configure()` once at app
 * start (outside components). Delivery itself runs natively and continues without JS.
 */
class SyncVaultImpl {
  private config: SyncVaultConfig = {};
  private configured: Promise<void> | null = null;
  private nativeSubs: NativeSubscription[] = [];
  private eventListeners = new Set<(event: SyncEvent) => void>();
  private networkListeners = new Set<(state: NetworkState) => void>();
  private conflictListeners = new Set<(conflict: Conflict) => void>();
  private mergeFunctions = new Map<string, MergeFunction>();
  private resolvingConflicts = new Set<string>();
  private authRefresh: Promise<void> | null = null;

  private get native(): Spec {
    return getNative();
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Persists the configuration natively (background workers read it without JS), installs the
   * auth and conflict handlers, and starts draining. Safe to call again to change settings.
   */
  configure(config: SyncVaultConfig = {}): Promise<void> {
    this.config = { ...config };
    const run = (async () => {
      this.attachNativeListeners();
      const native = this.native;
      await native.configure(this.toNativeConfig(config));
      if (config.getAuthHeaders) {
        await this.refreshAuth({ reason: 'configure' });
      }
      const interval = config.backgroundIntervalMinutes ?? DEFAULT_NATIVE_CONFIG.backgroundIntervalMinutes;
      if (interval > 0) {
        native.scheduleBackgroundDrain({
          intervalMinutes: interval,
          requiresUnmeteredNetwork: config.wifiOnly ?? false,
          requiresCharging: config.requiresCharging ?? false,
        });
      } else {
        native.cancelBackgroundDrain();
      }
      // Conflicts produced by background drains while JS was not running.
      void this.resolvePendingConflicts();
    })();
    this.configured = run;
    return run;
  }

  get isConfigured(): boolean {
    return this.configured != null;
  }

  private toNativeConfig(config: SyncVaultConfig): NativeConfig {
    const d = DEFAULT_NATIVE_CONFIG;
    return {
      baseUrl: config.baseUrl ?? d.baseUrl,
      maxConcurrency: config.maxConcurrency ?? d.maxConcurrency,
      requestTimeoutMs: config.requestTimeoutMs ?? d.requestTimeoutMs,
      leaseMs: config.leaseMs ?? d.leaseMs,
      defaultMaxAttempts: config.maxAttempts ?? d.defaultMaxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs ?? d.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs ?? d.retryMaxDelayMs,
      encryptPayloads: config.encryptPayloads ?? d.encryptPayloads,
      wifiOnly: config.wifiOnly ?? d.wifiOnly,
      requiresCharging: config.requiresCharging ?? d.requiresCharging,
      minBatteryLevel: config.minBatteryLevel ?? d.minBatteryLevel,
      backgroundIntervalMinutes: config.backgroundIntervalMinutes ?? d.backgroundIntervalMinutes,
      largePayloadThresholdBytes: config.largePayloadThresholdBytes ?? d.largePayloadThresholdBytes,
      notificationTitle: config.notificationTitle ?? d.notificationTitle,
    };
  }

  private reportError(error: unknown, context: string): void {
    if (this.config.onError) {
      try {
        this.config.onError(error, context);
      } catch {
        // Never let the error reporter break the engine.
      }
    } else if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[SyncVault] ${context}:`, error);
    }
  }

  private attachNativeListeners(): void {
    if (this.nativeSubs.length > 0) return;
    const native = this.native;
    this.nativeSubs.push(
      native.onRequestEvent((event: RequestEvent) => this.handleRequestEvent(event)),
      native.onNetworkChange((state: NetworkState) => {
        for (const listener of Array.from(this.networkListeners)) this.safeCall(() => listener(state), 'network listener');
      }),
      native.onAuthHeadersNeeded((event: AuthHeadersNeededEvent) => {
        void this.handleAuthNeeded(event);
      }),
      native.onConflict((event: ConflictEvent) => {
        void this.handleConflict(toConflict(event));
      })
    );
  }

  private safeCall(fn: () => void, context: string): void {
    try {
      fn();
    } catch (error) {
      this.reportError(error, context);
    }
  }

  private handleRequestEvent(raw: RequestEvent): void {
    const event = raw as unknown as SyncEvent;
    if (event.id && (event.type === 'succeeded' || event.type === 'dead_lettered' || event.type === 'discarded')) {
      this.mergeFunctions.delete(event.id);
    }
    if (this.config.onEvent) this.safeCall(() => this.config.onEvent!(event), 'onEvent');
    for (const listener of Array.from(this.eventListeners)) this.safeCall(() => listener(event), 'event listener');
  }

  // ------------------------------------------------------------------ auth

  /** Stores headers natively and unblocks requests parked on 401. Call after login. */
  setAuthHeaders(headers: Record<string, string>): void {
    this.native.setAuthHeaders(headers);
  }

  /** Re-runs `getAuthHeaders` (single-flight) and pushes the result to native. */
  refreshAuth(context: AuthContext = { reason: 'manual' }): Promise<void> {
    const provider = this.config.getAuthHeaders;
    if (!provider) return Promise.resolve();
    if (this.authRefresh) return this.authRefresh;
    this.authRefresh = (async () => {
      try {
        const headers = await provider(context);
        this.native.setAuthHeaders(headers ?? {});
      } catch (error) {
        this.reportError(error, 'getAuthHeaders');
      } finally {
        this.authRefresh = null;
      }
    })();
    return this.authRefresh;
  }

  private async handleAuthNeeded(event: AuthHeadersNeededEvent): Promise<void> {
    const provider = this.config.getAuthHeaders;
    if (!provider) return;
    if (this.authRefresh) {
      await this.authRefresh;
      return;
    }
    this.authRefresh = (async () => {
      try {
        const headers = await provider({ reason: 'unauthorized', requestId: event.requestId, httpStatus: event.httpStatus });
        this.native.provideAuthHeaders(event.requestToken, headers ?? {});
      } catch (error) {
        // Requests stay parked (no attempts burned) until headers are provided.
        this.reportError(error, 'getAuthHeaders');
      } finally {
        this.authRefresh = null;
      }
    })();
    await this.authRefresh;
  }

  // ------------------------------------------------------------------ queue

  /**
   * Durably queues a request. Resolves with the request id once the row is committed natively;
   * from then on delivery survives app restarts, crashes, and reboots.
   */
  async enqueue(options: EnqueueOptions): Promise<string> {
    if (!options.method || !options.url) throw new Error('react-native-sync-vault: enqueue requires method and url');
    const { body, contentType } = serializeBody(options.body, options.contentType);
    const strategy = options.conflictStrategy ?? (options.merge ? 'merge' : 'manual');
    const request: EnqueueRequest = {
      method: options.method.toUpperCase(),
      url: appendQuery(options.url, options.queryParams),
      headers: { ...(options.headers ?? {}) },
      body,
      contentType,
      idempotencyKey: options.idempotencyKey ?? null,
      queueKey: options.queueKey ?? null,
      dedupeKey: options.dedupeKey ?? null,
      ifMatch: options.ifMatch ?? null,
      priority: options.priority ?? 0,
      maxAttempts: options.maxAttempts ?? 0,
      // Merge functions cannot be persisted; native parks the request and JS resolves it.
      conflictStrategy: strategy === 'merge' ? 'manual' : strategy,
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
    };
    const id = await this.native.enqueue(request);
    if (options.merge) this.mergeFunctions.set(id, options.merge);
    return id;
  }

  async getRequests(query: RequestQuery = {}): Promise<SyncRequest[]> {
    const statuses = query.status == null ? [] : Array.isArray(query.status) ? query.status : [query.status];
    const rows = await this.native.getRequests({
      statuses,
      queueKey: query.queueKey ?? null,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
    });
    return rows.map(toSyncRequest);
  }

  async getRequest(id: string): Promise<SyncRequest | null> {
    const rows = await this.getRequests({ status: ALL_STATES, limit: 10_000 });
    return rows.find((r) => r.id === id) ?? null;
  }

  getPending(limit = 100): Promise<SyncRequest[]> {
    return this.getRequests({ status: ['pending', 'inflight'], limit });
  }

  getDeadLetters(limit = 100): Promise<SyncRequest[]> {
    return this.getRequests({ status: 'dead_letter', limit });
  }

  getConflicts(limit = 100): Promise<SyncRequest[]> {
    return this.getRequests({ status: 'conflict', limit });
  }

  getCounts(): Promise<QueueCounts> {
    return this.native.getCounts();
  }

  /** Moves a dead-lettered or conflicted request back to pending with a fresh attempt budget. */
  retry(id: string): Promise<void> {
    return this.native.retry(id);
  }

  retryAllDeadLetters(): Promise<number> {
    return this.native.retryAllDeadLetters();
  }

  /** Permanently removes a request that is not currently in flight. */
  discard(id: string): Promise<void> {
    this.mergeFunctions.delete(id);
    return this.native.discard(id);
  }

  purgeSucceeded(olderThanMs = 0): Promise<number> {
    return this.native.purgeSucceeded(olderThanMs);
  }

  drainNow(): void {
    this.native.drainNow();
  }

  scheduleBackgroundDrain(options: BackgroundDrainOptions = {}): void {
    this.native.scheduleBackgroundDrain({
      intervalMinutes: options.intervalMinutes ?? DEFAULT_NATIVE_CONFIG.backgroundIntervalMinutes,
      requiresUnmeteredNetwork: options.requiresUnmeteredNetwork ?? false,
      requiresCharging: options.requiresCharging ?? false,
    });
  }

  cancelBackgroundDrain(): void {
    this.native.cancelBackgroundDrain();
  }

  getNetworkState(): NetworkState {
    return this.native.getNetworkState();
  }

  getPowerState(): PowerState {
    return this.native.getPowerState();
  }

  /** UUIDv7, suitable as a client-generated primary key for offline creates. */
  generateId(): string {
    return hasSecureRandom() ? uuidv7() : this.native.generateId();
  }

  // ------------------------------------------------------------------ conflicts

  /**
   * Resolves a request in `conflict`. keep_local and merge persist the payload natively with the
   * server's version as If-Match and a new idempotency key, then the request is redelivered.
   */
  async resolveConflict(id: string, resolution: ConflictResolution): Promise<void> {
    if (resolution.action === 'manual') return;
    if (resolution.action === 'keep_server') {
      this.mergeFunctions.delete(id);
      await this.native.resolveConflict(id, null, null);
      return;
    }
    const request = await this.getRequest(id);
    if (!request || request.status !== 'conflict') throw new Error(`react-native-sync-vault: request ${id} is not in conflict`);
    const payload =
      resolution.action === 'keep_local' ? request.body : serializeBody(resolution.payload, request.contentType ?? undefined).body;
    await this.native.resolveConflict(id, payload ?? '', request.serverVersion);
  }

  private async handleConflict(conflict: Conflict): Promise<void> {
    for (const listener of Array.from(this.conflictListeners)) this.safeCall(() => listener(conflict), 'conflict listener');
    if (this.resolvingConflicts.has(conflict.id)) return;
    const merge = this.mergeFunctions.get(conflict.id);
    const resolver = this.config.conflictResolver;
    if (!merge && !resolver) return;
    this.resolvingConflicts.add(conflict.id);
    try {
      const resolution: ConflictResolution = merge
        ? { action: 'merge', payload: await merge(conflict.local, conflict.server, conflict) }
        : await resolver!(conflict);
      await this.resolveConflict(conflict.id, resolution);
    } catch (error) {
      this.reportError(error, 'conflict resolution');
    } finally {
      this.resolvingConflicts.delete(conflict.id);
    }
  }

  private async resolvePendingConflicts(): Promise<void> {
    if (!this.config.conflictResolver) return;
    try {
      const conflicts = await this.getConflicts(500);
      for (const row of conflicts) {
        await this.handleConflict(
          toConflict({
            id: row.id,
            method: row.method,
            url: row.url,
            localBody: row.body,
            serverBody: row.serverResponse,
            serverVersion: row.serverVersion,
            httpStatus: row.lastHttpStatus,
          })
        );
      }
    } catch (error) {
      this.reportError(error, 'resolvePendingConflicts');
    }
  }

  // ------------------------------------------------------------------ subscriptions

  addEventListener(listener: (event: SyncEvent) => void): Unsubscribe {
    this.attachNativeListeners();
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  addNetworkListener(listener: (state: NetworkState) => void): Unsubscribe {
    this.attachNativeListeners();
    this.networkListeners.add(listener);
    return () => this.networkListeners.delete(listener);
  }

  addConflictListener(listener: (conflict: Conflict) => void): Unsubscribe {
    this.attachNativeListeners();
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  // ------------------------------------------------------------------ cache

  readonly cache = {
    get: async <T = unknown>(key: string): Promise<CachedValue<T> | null> => {
      const entry = await this.native.cacheGet(key);
      if (!entry) return null;
      return { value: parseMaybeJson(entry.value) as T, tags: entry.tags, expiresAt: entry.expiresAt, createdAt: entry.createdAt };
    },
    set: (key: string, value: unknown, options: CacheSetOptions = {}): Promise<void> =>
      this.native.cacheSet(key, JSON.stringify(value), options.ttlMs ?? 0, options.tags ?? []),
    delete: (key: string): Promise<void> => this.native.cacheDelete(key),
    invalidate: (options: { prefix?: string; tags?: string[] }): Promise<number> =>
      this.native.cacheInvalidate(options.prefix ?? null, options.tags ?? []),
    clear: (): Promise<void> => this.native.cacheClear(),
    stats: () => this.native.cacheStats(),
    evict: (maxBytes: number): Promise<number> => this.native.cacheEvict(maxBytes),
  };

  /** Detaches listeners and forgets configuration. For tests. */
  reset(): void {
    for (const sub of this.nativeSubs) sub.remove();
    this.nativeSubs = [];
    this.eventListeners.clear();
    this.networkListeners.clear();
    this.conflictListeners.clear();
    this.mergeFunctions.clear();
    this.resolvingConflicts.clear();
    this.authRefresh = null;
    this.configured = null;
    this.config = {};
  }
}

export type SyncVaultInstance = SyncVaultImpl;

export const SyncVault = new SyncVaultImpl();
