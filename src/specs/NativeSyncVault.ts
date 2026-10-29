import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type {
  Double,
  EventEmitter,
  Int32,
} from 'react-native/Libraries/Types/CodegenTypes';

/**
 * Persisted engine configuration. Native stores it so background workers
 * (WorkManager / BGTaskScheduler) can drain the queue without JS running.
 */
export type NativeConfig = {
  baseUrl: string;
  maxConcurrency: Int32;
  requestTimeoutMs: Int32;
  leaseMs: Int32;
  defaultMaxAttempts: Int32;
  retryBaseDelayMs: Int32;
  retryMaxDelayMs: Int32;
  encryptPayloads: boolean;
  wifiOnly: boolean;
  requiresCharging: boolean;
  minBatteryLevel: Double;
  backgroundIntervalMinutes: Int32;
  largePayloadThresholdBytes: Int32;
  notificationTitle: string;
};

export type EnqueueRequest = {
  method: string;
  /** Absolute URL, or a path resolved against NativeConfig.baseUrl at send time. */
  url: string;
  headers: { [key: string]: string };
  /** Serialized body (JSON or text). Null for bodiless requests. */
  body: string | null;
  contentType: string | null;
  idempotencyKey: string | null;
  /** Requests sharing a queueKey are delivered strictly in FIFO order. */
  queueKey: string | null;
  /** A newer pending request with the same dedupeKey replaces the older one. */
  dedupeKey: string | null;
  /** Sent as If-Match for optimistic concurrency. */
  ifMatch: string | null;
  priority: Int32;
  /** 0 means NativeConfig.defaultMaxAttempts. */
  maxAttempts: Int32;
  /** One of: manual, client_wins, server_wins. */
  conflictStrategy: string;
  /** Serialized JSON, opaque to native. */
  metadata: string | null;
};

export type QueuedRequest = {
  id: string;
  idempotencyKey: string;
  queueKey: string | null;
  dedupeKey: string | null;
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: string | null;
  contentType: string | null;
  ifMatch: string | null;
  /** One of: pending, inflight, succeeded, conflict, dead_letter. */
  status: string;
  priority: Int32;
  attempt: Int32;
  maxAttempts: Int32;
  nextAttemptAt: Double;
  authBlocked: boolean;
  conflictStrategy: string;
  lastError: string | null;
  lastHttpStatus: Int32;
  serverResponse: string | null;
  serverVersion: string | null;
  metadata: string | null;
  createdAt: Double;
  updatedAt: Double;
  completedAt: Double;
};

export type RequestFilter = {
  statuses: string[];
  queueKey: string | null;
  limit: Int32;
  offset: Int32;
};

export type QueueCounts = {
  pending: Int32;
  inflight: Int32;
  conflict: Int32;
  deadLetter: Int32;
  succeeded: Int32;
  authBlocked: Int32;
};

export type DrainPolicy = {
  intervalMinutes: Int32;
  requiresUnmeteredNetwork: boolean;
  requiresCharging: boolean;
};

export type NetworkState = {
  isConnected: boolean;
  isInternetReachable: boolean;
  /** One of: wifi, cellular, ethernet, other, none, unknown. */
  type: string;
  isExpensive: boolean;
  isConstrained: boolean;
};

export type PowerState = {
  /** 0..1, or -1 when unknown. */
  batteryLevel: Double;
  isCharging: boolean;
  isLowPowerMode: boolean;
};

export type CacheEntry = {
  key: string;
  value: string;
  tags: string[];
  expiresAt: Double;
  createdAt: Double;
};

export type CacheStats = {
  entries: Int32;
  sizeBytes: Double;
};

export type RequestEvent = {
  /**
   * One of: enqueued, coalesced, attempt, succeeded, retry_scheduled,
   * dead_lettered, conflict, conflict_resolved, discarded, auth_blocked,
   * drain_started, drain_finished.
   */
  type: string;
  id: string | null;
  status: string | null;
  attempt: Int32;
  httpStatus: Int32;
  error: string | null;
  nextAttemptAt: Double;
  timestamp: Double;
};

export type AuthHeadersNeededEvent = {
  requestToken: string;
  requestId: string;
  httpStatus: Int32;
};

export type ConflictEvent = {
  id: string;
  method: string;
  url: string;
  localBody: string | null;
  serverBody: string | null;
  serverVersion: string | null;
  httpStatus: Int32;
};

export interface Spec extends TurboModule {
  configure(config: NativeConfig): Promise<void>;

  enqueue(request: EnqueueRequest): Promise<string>;
  getRequests(filter: RequestFilter): Promise<QueuedRequest[]>;
  getCounts(): Promise<QueueCounts>;
  retry(id: string): Promise<void>;
  retryAllDeadLetters(): Promise<Int32>;
  discard(id: string): Promise<void>;
  /** payload null discards the local change (server wins). */
  resolveConflict(id: string, payload: string | null, version: string | null): Promise<void>;
  purgeSucceeded(olderThanMs: Double): Promise<Int32>;

  drainNow(): void;
  scheduleBackgroundDrain(policy: DrainPolicy): void;
  cancelBackgroundDrain(): void;

  getNetworkState(): NetworkState;
  getPowerState(): PowerState;
  generateId(): string;

  setAuthHeaders(headers: { [key: string]: string }): void;
  provideAuthHeaders(requestToken: string, headers: { [key: string]: string }): void;

  cacheGet(key: string): Promise<CacheEntry | null>;
  cacheSet(key: string, value: string, ttlMs: Double, tags: string[]): Promise<void>;
  cacheDelete(key: string): Promise<void>;
  cacheInvalidate(prefix: string | null, tags: string[]): Promise<Int32>;
  cacheClear(): Promise<void>;
  cacheStats(): Promise<CacheStats>;
  cacheEvict(maxBytes: Double): Promise<Int32>;

  readonly onRequestEvent: EventEmitter<RequestEvent>;
  readonly onNetworkChange: EventEmitter<NetworkState>;
  readonly onAuthHeadersNeeded: EventEmitter<AuthHeadersNeededEvent>;
  readonly onConflict: EventEmitter<ConflictEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('SyncVault');
