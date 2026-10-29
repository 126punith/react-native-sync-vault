/**
 * In-memory reference implementation of the SyncVault Turbo Module spec.
 *
 * It implements the same outbox state machine as SyncVaultCore.kt / SyncVaultCore.swift and is
 * the executable specification for the contract, property, and chaos tests. Apps can also use
 * it as a Jest mock via `setNativeImplementation(new MemorySyncVault({ transport }))`.
 */
import type {
  AuthHeadersNeededEvent,
  CacheEntry,
  CacheStats,
  ConflictEvent,
  DrainPolicy,
  EnqueueRequest,
  NativeConfig,
  NetworkState,
  PowerState,
  QueueCounts,
  QueuedRequest,
  RequestEvent,
  RequestFilter,
  Spec,
} from '../specs/NativeSyncVault';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';
import { DEFAULT_NATIVE_CONFIG, SUCCEEDED_RETENTION_MS } from '../core/defaults';
import { classify, nextAttemptAt, parseRetryAfterMs } from '../core/retryPolicy';
import { uuidv7 } from '../core/uuid';

export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface TransportResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | null;
}

/** Throwing (or timing out) is treated as a network error. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

type Listener<T> = (value: T) => void | Promise<void>;
type Subscription = ReturnType<EventEmitter<unknown>>;

class Emitter<T> {
  private listeners = new Set<Listener<T>>();

  readonly subscribe = (listener: Listener<T>): Subscription => {
    this.listeners.add(listener);
    const remove = () => {
      this.listeners.delete(listener);
    };
    // Only remove() is part of the contract consumers rely on.
    return { remove } as unknown as Subscription;
  };

  emit(value: T): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        void listener(value);
      } catch {
        // Listener errors must never break delivery.
      }
    }
  }
}

interface Row {
  seq: number;
  id: string;
  idempotencyKey: string;
  queueKey: string | null;
  dedupeKey: string | null;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  contentType: string | null;
  ifMatch: string | null;
  status: string;
  priority: number;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: number;
  leaseUntil: number | null;
  authBlocked: boolean;
  conflictStrategy: string;
  lastError: string | null;
  lastHttpStatus: number;
  serverResponse: string | null;
  serverVersion: string | null;
  metadata: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
}

interface CacheRow {
  key: string;
  value: string;
  tags: string[];
  expiresAt: number;
  size: number;
  createdAt: number;
  lastAccessedAt: number;
}

/** The "disk": survives `crash()` so a new engine instance can recover from it. */
export class MemoryStore {
  rows = new Map<string, Row>();
  seq = 0;
  kv = new Map<string, string>();
  cache = new Map<string, CacheRow>();
}

const MAX_STORED_RESPONSE = 64 * 1024;
const UNFINISHED = new Set(['pending', 'inflight', 'conflict']);

export interface MemorySyncVaultOptions {
  transport?: Transport;
  store?: MemoryStore;
  now?: () => number;
  random?: () => number;
  network?: Partial<NetworkState>;
  power?: Partial<PowerState>;
  /** Arm timers for backoff wake-ups like the native engines do. Default true. */
  autoDrain?: boolean;
}

export class MemorySyncVault implements Spec {
  readonly store: MemoryStore;

  private transport: Transport;
  private now: () => number;
  private random: () => number;
  private autoDrain: boolean;
  private network: NetworkState;
  private power: PowerState;
  private authHeaders: Record<string, string> | null = null;
  private draining: Promise<void> | null = null;
  private drainRequested = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private killed = false;
  private background: DrainPolicy | null = null;

  private requestEvents = new Emitter<RequestEvent>();
  private networkEvents = new Emitter<NetworkState>();
  private authEvents = new Emitter<AuthHeadersNeededEvent>();
  private conflictEvents = new Emitter<ConflictEvent>();

  readonly onRequestEvent = this.requestEvents.subscribe;
  readonly onNetworkChange = this.networkEvents.subscribe;
  readonly onAuthHeadersNeeded = this.authEvents.subscribe;
  readonly onConflict = this.conflictEvents.subscribe;

  constructor(options: MemorySyncVaultOptions = {}) {
    this.store = options.store ?? new MemoryStore();
    this.transport = options.transport ?? defaultFetchTransport;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.autoDrain = options.autoDrain ?? true;
    this.network = {
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
      isExpensive: false,
      isConstrained: false,
      ...options.network,
    };
    this.power = { batteryLevel: 1, isCharging: true, isLowPowerMode: false, ...options.power };
    const storedAuth = this.store.kv.get('auth_headers');
    this.authHeaders = storedAuth ? JSON.parse(storedAuth) : null;
    // A fresh process owns no in-flight work: everything inflight was interrupted.
    this.recoverLeases(Number.MAX_SAFE_INTEGER);
    // Like the native engines, start delivering on launch without waiting for JS.
    queueMicrotask(() => this.requestDrain());
  }

  // ---------------------------------------------------------------- test controls

  /** Simulates the process being killed: in-flight responses are dropped, timers stop. */
  crash(): MemoryStore {
    this.killed = true;
    this.clearWake();
    return this.store;
  }

  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  setNetwork(state: Partial<NetworkState>): void {
    const wasConnected = this.network.isConnected;
    this.network = { ...this.network, ...state };
    this.networkEvents.emit({ ...this.network });
    if (!wasConnected && this.network.isConnected) this.requestDrain();
  }

  setPower(state: Partial<PowerState>): void {
    this.power = { ...this.power, ...state };
  }

  /** Runs drains until the engine is idle (nothing eligible right now). */
  async drain(): Promise<void> {
    this.drainRequested = true;
    while (this.draining) await this.draining;
    if (this.drainRequested) await this.startDrain();
  }

  get scheduledBackgroundDrain(): DrainPolicy | null {
    return this.background;
  }

  // ---------------------------------------------------------------- Spec: queue

  private config(): NativeConfig {
    const stored = this.store.kv.get('config');
    return stored ? { ...DEFAULT_NATIVE_CONFIG, ...JSON.parse(stored) } : DEFAULT_NATIVE_CONFIG;
  }

  async configure(config: NativeConfig): Promise<void> {
    this.store.kv.set('config', JSON.stringify(config));
    await this.purgeSucceeded(SUCCEEDED_RETENTION_MS);
    this.requestDrain();
  }

  async enqueue(request: EnqueueRequest): Promise<string> {
    if (!request.method || !request.url) throw new Error('method and url are required');
    const config = this.config();
    const now = this.now();
    const maxAttempts = request.maxAttempts > 0 ? request.maxAttempts : config.defaultMaxAttempts;
    const method = request.method.toUpperCase();

    if (request.dedupeKey != null) {
      // Only the newest unfinished row may absorb the change; anything older is delivered first.
      const newest = Array.from(this.store.rows.values())
        .filter((r) => r.dedupeKey === request.dedupeKey && UNFINISHED.has(r.status))
        .sort((a, b) => b.seq - a.seq)[0];
      const existing = newest?.status === 'pending' ? newest : undefined;
      if (existing) {
        // Refunded attempts (offline, 401) may still have reached the server, so "ever sent" is
        // tracked through the last result rather than the attempt counter.
        const everSent = existing.attempt > 0 || existing.lastHttpStatus !== 0 || existing.lastError != null;
        Object.assign(existing, {
          method,
          url: request.url,
          headers: { ...request.headers },
          body: request.body,
          contentType: request.contentType,
          ifMatch: request.ifMatch,
          priority: request.priority,
          maxAttempts,
          conflictStrategy: request.conflictStrategy,
          metadata: request.metadata,
          attempt: 0,
          nextAttemptAt: 0,
          updatedAt: now,
        });
        // The server may already hold the old body under the old key; a new body needs a new key.
        if (everSent) {
          existing.idempotencyKey = request.idempotencyKey ?? uuidv7(now);
        }
        this.emitRequest('coalesced', existing);
        this.requestDrain();
        return existing.id;
      }
    }

    const id = uuidv7(now);
    const idempotencyKey = request.idempotencyKey ?? id;
    if (Array.from(this.store.rows.values()).some((r) => r.idempotencyKey === idempotencyKey)) {
      throw new Error(`UNIQUE constraint failed: outbox.idempotency_key (${idempotencyKey})`);
    }
    const row: Row = {
      seq: ++this.store.seq,
      id,
      idempotencyKey,
      queueKey: request.queueKey,
      dedupeKey: request.dedupeKey,
      method,
      url: request.url,
      headers: { ...request.headers },
      body: request.body,
      contentType: request.contentType,
      ifMatch: request.ifMatch,
      status: 'pending',
      priority: request.priority,
      attempt: 0,
      maxAttempts,
      nextAttemptAt: 0,
      leaseUntil: null,
      authBlocked: false,
      conflictStrategy: request.conflictStrategy || 'manual',
      lastError: null,
      lastHttpStatus: 0,
      serverResponse: null,
      serverVersion: null,
      metadata: request.metadata,
      createdAt: now,
      updatedAt: now,
      completedAt: 0,
    };
    this.store.rows.set(id, row);
    this.emitRequest('enqueued', row);
    this.requestDrain();
    return id;
  }

  async getRequests(filter: RequestFilter): Promise<QueuedRequest[]> {
    const limit = Math.max(filter.limit, 1);
    const offset = Math.max(filter.offset, 0);
    return this.sortedRows()
      .filter((r) => filter.statuses.length === 0 || filter.statuses.includes(r.status))
      .filter((r) => filter.queueKey == null || r.queueKey === filter.queueKey)
      .slice(offset, offset + limit)
      .map(toQueuedRequest);
  }

  async getCounts(): Promise<QueueCounts> {
    const counts: QueueCounts = { pending: 0, inflight: 0, conflict: 0, deadLetter: 0, succeeded: 0, authBlocked: 0 };
    for (const r of this.store.rows.values()) {
      if (r.status === 'pending') counts.pending++;
      if (r.status === 'inflight') counts.inflight++;
      if (r.status === 'conflict') counts.conflict++;
      if (r.status === 'dead_letter') counts.deadLetter++;
      if (r.status === 'succeeded') counts.succeeded++;
      if (r.status === 'pending' && r.authBlocked) counts.authBlocked++;
    }
    return counts;
  }

  async retry(id: string): Promise<void> {
    const row = this.store.rows.get(id);
    if (row && (row.status === 'dead_letter' || row.status === 'conflict')) {
      Object.assign(row, { status: 'pending', attempt: 0, nextAttemptAt: 0, authBlocked: false, completedAt: 0, updatedAt: this.now() });
      this.requestDrain();
    }
  }

  async retryAllDeadLetters(): Promise<number> {
    let count = 0;
    for (const row of this.store.rows.values()) {
      if (row.status === 'dead_letter') {
        Object.assign(row, { status: 'pending', attempt: 0, nextAttemptAt: 0, completedAt: 0, updatedAt: this.now() });
        count++;
      }
    }
    if (count > 0) this.requestDrain();
    return count;
  }

  async discard(id: string): Promise<void> {
    const row = this.store.rows.get(id);
    if (row && row.status !== 'inflight') {
      this.store.rows.delete(id);
      this.emitEvent({ type: 'discarded', id });
    }
  }

  async resolveConflict(id: string, payload: string | null, version: string | null): Promise<void> {
    const row = this.store.rows.get(id);
    if (!row || row.status !== 'conflict') throw new Error(`Request ${id} is not in conflict`);
    if (payload == null) {
      this.store.rows.delete(id);
      this.emitEvent({ type: 'discarded', id });
      return;
    }
    const now = this.now();
    Object.assign(row, {
      status: 'pending',
      body: payload,
      ifMatch: version,
      attempt: 0,
      nextAttemptAt: 0,
      idempotencyKey: uuidv7(now),
      updatedAt: now,
    });
    this.emitRequest('conflict_resolved', row);
    this.requestDrain();
  }

  async purgeSucceeded(olderThanMs: number): Promise<number> {
    const cutoff = this.now() - olderThanMs;
    let count = 0;
    for (const [id, row] of this.store.rows) {
      if (row.status === 'succeeded' && row.completedAt < cutoff) {
        this.store.rows.delete(id);
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------- Spec: scheduling

  drainNow(): void {
    this.requestDrain();
  }

  scheduleBackgroundDrain(policy: DrainPolicy): void {
    this.background = { ...policy };
  }

  cancelBackgroundDrain(): void {
    this.background = null;
  }

  getNetworkState(): NetworkState {
    return { ...this.network };
  }

  getPowerState(): PowerState {
    return { ...this.power };
  }

  generateId(): string {
    return uuidv7(this.now());
  }

  setAuthHeaders(headers: { [key: string]: string }): void {
    this.authHeaders = { ...headers };
    this.store.kv.set('auth_headers', JSON.stringify(this.authHeaders));
    const now = this.now();
    for (const row of this.store.rows.values()) {
      if (row.authBlocked) Object.assign(row, { authBlocked: false, nextAttemptAt: 0, updatedAt: now });
    }
    this.requestDrain();
  }

  provideAuthHeaders(_requestToken: string, headers: { [key: string]: string }): void {
    this.setAuthHeaders(headers);
  }

  // ---------------------------------------------------------------- Spec: cache

  async cacheGet(key: string): Promise<CacheEntry | null> {
    const row = this.store.cache.get(key);
    if (!row) return null;
    const now = this.now();
    if (row.expiresAt > 0 && row.expiresAt <= now) {
      this.store.cache.delete(key);
      return null;
    }
    row.lastAccessedAt = now;
    return { key: row.key, value: row.value, tags: [...row.tags], expiresAt: row.expiresAt, createdAt: row.createdAt };
  }

  async cacheSet(key: string, value: string, ttlMs: number, tags: string[]): Promise<void> {
    const now = this.now();
    this.store.cache.set(key, {
      key,
      value,
      tags: [...tags],
      expiresAt: ttlMs > 0 ? now + ttlMs : 0,
      size: utf8Length(key) + utf8Length(value),
      createdAt: now,
      lastAccessedAt: now,
    });
  }

  async cacheDelete(key: string): Promise<void> {
    this.store.cache.delete(key);
  }

  async cacheInvalidate(prefix: string | null, tags: string[]): Promise<number> {
    let count = 0;
    for (const [key, row] of this.store.cache) {
      const byPrefix = prefix != null && key.startsWith(prefix);
      const byTag = tags.some((t) => row.tags.includes(t));
      if (byPrefix || byTag) {
        this.store.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  async cacheClear(): Promise<void> {
    this.store.cache.clear();
  }

  async cacheStats(): Promise<CacheStats> {
    let sizeBytes = 0;
    for (const row of this.store.cache.values()) sizeBytes += row.size;
    return { entries: this.store.cache.size, sizeBytes };
  }

  async cacheEvict(maxBytes: number): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [key, row] of this.store.cache) {
      if (row.expiresAt > 0 && row.expiresAt <= now) {
        this.store.cache.delete(key);
        removed++;
      }
    }
    let total = (await this.cacheStats()).sizeBytes;
    const lru = Array.from(this.store.cache.values()).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const row of lru) {
      if (total <= maxBytes) break;
      this.store.cache.delete(row.key);
      total -= row.size;
      removed++;
    }
    return removed;
  }

  // ---------------------------------------------------------------- engine

  private requestDrain(): void {
    if (this.killed || !this.autoDrain) return;
    this.drainRequested = true;
    if (!this.draining) void this.startDrain();
  }

  private startDrain(): Promise<void> {
    const run = (async () => {
      try {
        while (this.drainRequested && !this.killed) {
          this.drainRequested = false;
          await this.drainOnce();
        }
      } finally {
        this.draining = null;
      }
      this.scheduleNextWake();
    })();
    this.draining = run;
    return run;
  }

  private policyAllows(config: NativeConfig): boolean {
    if (!this.network.isConnected) return false;
    if (config.wifiOnly && (this.network.isExpensive || this.network.isConstrained)) return false;
    if (config.requiresCharging && !this.power.isCharging) return false;
    if (
      config.minBatteryLevel > 0 &&
      !this.power.isCharging &&
      this.power.batteryLevel >= 0 &&
      this.power.batteryLevel < config.minBatteryLevel
    ) {
      return false;
    }
    return true;
  }

  private effectiveLeaseMs(config: NativeConfig): number {
    return Math.max(config.leaseMs, config.requestTimeoutMs * 2 + 10_000);
  }

  /**
   * An interrupted attempt still counts: rows that used their whole budget are dead-lettered
   * rather than sent again, which also stops a request that crashes the process from looping.
   */
  private recoverLeases(leaseCutoff: number): number {
    let count = 0;
    const now = this.now();
    for (const row of this.store.rows.values()) {
      if (row.status === 'inflight' && (row.leaseUntil == null || row.leaseUntil < leaseCutoff)) {
        if (row.attempt >= row.maxAttempts) {
          Object.assign(row, {
            status: 'dead_letter',
            leaseUntil: null,
            lastError: 'interrupted during the last allowed attempt',
            completedAt: now,
            updatedAt: now,
          });
        } else {
          Object.assign(row, { status: 'pending', leaseUntil: null, updatedAt: now });
        }
        count++;
      }
    }
    return count;
  }

  private sortedRows(): Row[] {
    return Array.from(this.store.rows.values()).sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  }

  /**
   * Within a queue_key (and a dedupe_key) only the oldest unfinished request is eligible: strict
   * FIFO per key. Ordering dedupe_key rows stops a retried older body overwriting a newer one.
   */
  private isHeadOfQueue(row: Row): boolean {
    if (row.queueKey == null && row.dedupeKey == null) return true;
    for (const other of this.store.rows.values()) {
      if (other.seq >= row.seq || !UNFINISHED.has(other.status)) continue;
      if (row.queueKey != null && other.queueKey === row.queueKey) return false;
      if (row.dedupeKey != null && other.dedupeKey === row.dedupeKey) return false;
    }
    return true;
  }

  private claimBatch(now: number, limit: number, leaseMs: number): Row[] {
    const ready = this.sortedRows()
      .filter((r) => r.status === 'pending' && !r.authBlocked && r.nextAttemptAt <= now && this.isHeadOfQueue(r))
      .slice(0, limit);
    for (const row of ready) {
      Object.assign(row, { status: 'inflight', attempt: row.attempt + 1, leaseUntil: now + leaseMs, updatedAt: now });
    }
    return ready.map((r) => ({ ...r, headers: { ...r.headers } }));
  }

  private nextWakeAt(): number | null {
    let min: number | null = null;
    for (const row of this.store.rows.values()) {
      if (row.status === 'pending' && !row.authBlocked && this.isHeadOfQueue(row)) {
        min = min == null ? row.nextAttemptAt : Math.min(min, row.nextAttemptAt);
      }
    }
    return min;
  }

  private async drainOnce(): Promise<void> {
    const config = this.config();
    if (!this.policyAllows(config)) return;
    this.recoverLeases(this.now());
    this.emitEvent({ type: 'drain_started' });
    while (!this.killed) {
      const batch = this.claimBatch(this.now(), Math.max(config.maxConcurrency, 1), this.effectiveLeaseMs(config));
      if (batch.length === 0) break;
      await Promise.all(batch.map((row) => this.process(row, config)));
      if (!this.policyAllows(config)) break;
    }
    if (!this.killed) this.emitEvent({ type: 'drain_finished' });
  }

  private buildUrl(config: NativeConfig, url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return `${config.baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  private async process(row: Row, config: NativeConfig): Promise<void> {
    this.emitRequest('attempt', row);
    const headers: Record<string, string> = { ...row.headers, ...(this.authHeaders ?? {}) };
    headers['Idempotency-Key'] = row.idempotencyKey;
    if (row.ifMatch != null) headers['If-Match'] = row.ifMatch;
    if (row.contentType != null) headers['Content-Type'] = row.contentType;
    const method = row.method.toUpperCase();
    const request: TransportRequest = {
      method,
      url: this.buildUrl(config, row.url),
      headers,
      body: method === 'GET' || method === 'HEAD' ? null : row.body,
    };

    let response: TransportResponse | null = null;
    let networkError: string | null = null;
    try {
      response = await withTimeout(this.transport(request), config.requestTimeoutMs);
    } catch (error) {
      networkError = error instanceof Error ? error.message : String(error);
    }
    // A killed process never observes the response; the lease recovers the row on restart.
    if (this.killed) return;
    const current = this.store.rows.get(row.id);
    if (!current || current.status !== 'inflight') return;
    this.applyResult(current, response, networkError, config);
  }

  private applyResult(row: Row, response: TransportResponse | null, networkError: string | null, config: NativeConfig): void {
    const now = this.now();
    if (networkError != null || response == null) {
      const error = networkError ?? 'network error';
      if (!this.network.isConnected) {
        // Lost connectivity mid-flight: do not burn an attempt.
        Object.assign(row, {
          status: 'pending',
          leaseUntil: null,
          nextAttemptAt: now,
          lastHttpStatus: 0,
          lastError: error,
          attempt: row.attempt - 1,
          updatedAt: now,
        });
        this.emitRequest('retry_scheduled', row, { error, nextAttemptAt: now });
        return;
      }
      this.retryOrDeadLetter(row, config, 0, error, null, null, now);
      return;
    }

    const headers = lowerKeys(response.headers ?? {});
    const body = response.body ?? null;
    const status = response.status;
    switch (classify(status)) {
      case 'success':
        Object.assign(row, {
          status: 'succeeded',
          leaseUntil: null,
          lastHttpStatus: status,
          serverResponse: truncate(body),
          serverVersion: headers.etag ?? null,
          lastError: null,
          completedAt: now,
          updatedAt: now,
        });
        this.emitRequest('succeeded', row, { httpStatus: status });
        return;

      case 'conflict': {
        const version = headers.etag ?? extractVersion(body);
        if (row.conflictStrategy === 'server_wins') {
          this.store.rows.delete(row.id);
          this.emitEvent({ type: 'discarded', id: row.id, httpStatus: status, error: 'server_wins' });
          return;
        }
        if (row.conflictStrategy === 'client_wins' && version != null && row.attempt < row.maxAttempts) {
          Object.assign(row, { status: 'pending', leaseUntil: null, ifMatch: version, nextAttemptAt: 0, updatedAt: now });
          this.emitRequest('conflict_resolved', row, { httpStatus: status, error: 'client_wins' });
          return;
        }
        Object.assign(row, {
          status: 'conflict',
          leaseUntil: null,
          lastHttpStatus: status,
          serverResponse: truncate(body),
          serverVersion: version,
          updatedAt: now,
        });
        this.emitRequest('conflict', row, { httpStatus: status });
        this.conflictEvents.emit({
          id: row.id,
          method: row.method,
          url: row.url,
          localBody: row.body,
          serverBody: body,
          serverVersion: version,
          httpStatus: status,
        });
        return;
      }

      case 'auth':
        Object.assign(row, {
          status: 'pending',
          leaseUntil: null,
          authBlocked: true,
          lastHttpStatus: status,
          lastError: 'unauthorized',
          attempt: Math.max(row.attempt - 1, 0),
          updatedAt: now,
        });
        this.authHeaders = null;
        this.emitRequest('auth_blocked', row, { httpStatus: status });
        this.authEvents.emit({ requestToken: uuidv7(now), requestId: row.id, httpStatus: status });
        return;

      case 'retryable':
        this.retryOrDeadLetter(row, config, status, `HTTP ${status}`, body, parseRetryAfterMs(headers['retry-after'], now), now);
        return;

      case 'permanent':
        this.markDeadLetter(row, status, `HTTP ${status}`, body, now);
        return;
    }
  }

  private retryOrDeadLetter(
    row: Row,
    config: NativeConfig,
    httpStatus: number,
    error: string,
    body: string | null,
    retryAfterMs: number | null,
    now: number
  ): void {
    if (row.attempt >= row.maxAttempts) {
      this.markDeadLetter(row, httpStatus, `max attempts reached (${error})`, body, now);
      return;
    }
    const next = nextAttemptAt(now, row.attempt, config.retryBaseDelayMs, config.retryMaxDelayMs, retryAfterMs, this.random());
    Object.assign(row, {
      status: 'pending',
      leaseUntil: null,
      nextAttemptAt: next,
      lastHttpStatus: httpStatus,
      lastError: error,
      updatedAt: now,
    });
    this.emitRequest('retry_scheduled', row, { httpStatus, error, nextAttemptAt: next });
  }

  private markDeadLetter(row: Row, httpStatus: number, error: string, body: string | null, now: number): void {
    Object.assign(row, {
      status: 'dead_letter',
      leaseUntil: null,
      lastHttpStatus: httpStatus,
      lastError: error,
      serverResponse: truncate(body),
      completedAt: now,
      updatedAt: now,
    });
    this.emitRequest('dead_lettered', row, { httpStatus, error });
  }

  private clearWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  private scheduleNextWake(): void {
    this.clearWake();
    if (this.killed || !this.autoDrain) return;
    const next = this.nextWakeAt();
    if (next == null || !this.policyAllows(this.config())) return;
    const delay = Math.max(next - this.now(), 250);
    this.wakeTimer = setTimeout(() => this.requestDrain(), delay);
    const timer = this.wakeTimer as { unref?: () => void };
    timer.unref?.();
  }

  private emitRequest(type: string, row: Row, extra: Partial<RequestEvent> = {}): void {
    this.emitEvent({
      type,
      id: row.id,
      status: row.status,
      attempt: row.attempt,
      ...extra,
    });
  }

  private emitEvent(event: Partial<RequestEvent> & { type: string }): void {
    if (this.killed) return;
    this.requestEvents.emit({
      id: null,
      status: null,
      attempt: 0,
      httpStatus: 0,
      error: null,
      nextAttemptAt: 0,
      timestamp: this.now(),
      ...event,
    });
  }
}

function toQueuedRequest(row: Row): QueuedRequest {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    queueKey: row.queueKey,
    dedupeKey: row.dedupeKey,
    method: row.method,
    url: row.url,
    headers: { ...row.headers },
    body: row.body,
    contentType: row.contentType,
    ifMatch: row.ifMatch,
    status: row.status,
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt,
    authBlocked: row.authBlocked,
    conflictStrategy: row.conflictStrategy,
    lastError: row.lastError,
    lastHttpStatus: row.lastHttpStatus,
    serverResponse: row.serverResponse,
    serverVersion: row.serverVersion,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

function truncate(value: string | null): string | null {
  return value == null ? null : value.slice(0, MAX_STORED_RESPONSE);
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function extractVersion(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      for (const key of ['version', '_version', 'etag']) {
        const value = (parsed as Record<string, unknown>)[key];
        if (value != null) return String(value);
      }
    }
  } catch {
    // Not JSON.
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!(ms > 0)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    (timer as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const defaultFetchTransport: Transport = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body ?? undefined,
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });
  return { status: response.status, headers, body: await response.text() };
};
