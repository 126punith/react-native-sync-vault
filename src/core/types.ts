import type { NetworkState, PowerState, QueueCounts } from '../specs/NativeSyncVault';

export type { NetworkState, PowerState, QueueCounts };

/** Outbox states. Only `succeeded` and `dead_letter` are terminal. */
export type RequestState = 'pending' | 'inflight' | 'succeeded' | 'conflict' | 'dead_letter';

/**
 * - manual: park in `conflict` until resolved (via conflictResolver or resolveConflict()).
 * - client_wins: resend the local payload with the server's version as If-Match.
 * - server_wins: drop the local change.
 * - merge: call the request's `merge` function (or the global conflictResolver) in JS.
 */
export type ConflictStrategy = 'manual' | 'client_wins' | 'server_wins' | 'merge';

export type SyncEventType =
  | 'enqueued'
  | 'coalesced'
  | 'attempt'
  | 'succeeded'
  | 'retry_scheduled'
  | 'dead_lettered'
  | 'conflict'
  | 'conflict_resolved'
  | 'discarded'
  | 'auth_blocked'
  | 'drain_started'
  | 'drain_finished';

export interface SyncEvent {
  type: SyncEventType;
  id: string | null;
  status: RequestState | null;
  attempt: number;
  httpStatus: number;
  error: string | null;
  nextAttemptAt: number;
  timestamp: number;
}

export interface SyncRequest {
  id: string;
  idempotencyKey: string;
  queueKey: string | null;
  dedupeKey: string | null;
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Serialized body as stored in the outbox. */
  body: string | null;
  contentType: string | null;
  ifMatch: string | null;
  status: RequestState;
  priority: number;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: number;
  authBlocked: boolean;
  conflictStrategy: string;
  lastError: string | null;
  lastHttpStatus: number;
  serverResponse: string | null;
  serverVersion: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number;
}

export interface Conflict {
  id: string;
  method: string;
  url: string;
  /** Parsed JSON when possible, otherwise the raw string. */
  local: unknown;
  server: unknown;
  localBody: string | null;
  serverBody: string | null;
  serverVersion: string | null;
  httpStatus: number;
}

export type ConflictResolution =
  /** Resend the local payload against the server's current version. */
  | { action: 'keep_local' }
  /** Drop the local change. */
  | { action: 'keep_server' }
  /** Send `payload` against the server's current version. */
  | { action: 'merge'; payload: unknown }
  /** Leave the request in `conflict` for the UI to resolve later. */
  | { action: 'manual' };

export type MergeFunction = (local: unknown, server: unknown, conflict: Conflict) => unknown | Promise<unknown>;

export interface AuthContext {
  reason: 'configure' | 'unauthorized' | 'manual';
  requestId?: string;
  httpStatus?: number;
}

export interface SyncVaultConfig {
  /** Relative request URLs are resolved against this at send time. */
  baseUrl?: string;
  /** Parallel requests across different queue keys. Default 4. */
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  /** Minimum lease for an in-flight request; native extends it to 2x timeout + 10s. */
  leaseMs?: number;
  /** Default attempts before a retryable failure is dead-lettered. Default 8. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  /** Encrypt bodies and headers at rest (Android Keystore / iOS Keychain key). */
  encryptPayloads?: boolean;
  wifiOnly?: boolean;
  requiresCharging?: boolean;
  /** 0..1. Below this level (and not charging) the queue pauses. */
  minBatteryLevel?: number;
  /** Periodic background drain (WorkManager / BGAppRefreshTask). 0 disables. Default 15. */
  backgroundIntervalMinutes?: number;
  /** Bodies above this size are stored as files and uploaded in the background. */
  largePayloadThresholdBytes?: number;
  /** Android foreground-service notification title for large uploads. */
  notificationTitle?: string;

  /**
   * Called at configure time and whenever the server answers 401. Headers are stored natively
   * and attached at send time, so tokens refreshed later apply to already queued requests.
   */
  getAuthHeaders?: (context: AuthContext) => Record<string, string> | Promise<Record<string, string>>;
  /** Global handler for requests in conflict (manual and merge strategies). */
  conflictResolver?: (conflict: Conflict) => ConflictResolution | Promise<ConflictResolution>;
  /** Structured events for logging or monitoring (Sentry, Datadog, ...). */
  onEvent?: (event: SyncEvent) => void;
  /** Errors from auth providers, resolvers, and listeners. */
  onError?: (error: unknown, context: string) => void;
}

export interface EnqueueOptions {
  method: string;
  /** Absolute URL, or a path resolved against `baseUrl`. */
  url: string;
  /** Objects are JSON-serialized; strings are sent as-is. */
  body?: unknown;
  headers?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  contentType?: string;
  /** Defaults to the request id (a UUIDv7). */
  idempotencyKey?: string;
  /** Requests with the same key are delivered strictly in order, e.g. `todo:123`. */
  queueKey?: string;
  /** A newer pending request with the same key replaces the older one. */
  dedupeKey?: string;
  ifMatch?: string;
  /** Higher first. Default 0. */
  priority?: number;
  maxAttempts?: number;
  conflictStrategy?: ConflictStrategy;
  /** Used with conflictStrategy 'merge' while the app process is alive. */
  merge?: MergeFunction;
  metadata?: Record<string, unknown>;
}

export interface RequestQuery {
  status?: RequestState | RequestState[];
  queueKey?: string;
  limit?: number;
  offset?: number;
}

export interface BackgroundDrainOptions {
  intervalMinutes?: number;
  requiresUnmeteredNetwork?: boolean;
  requiresCharging?: boolean;
}

export interface CachedValue<T> {
  value: T;
  tags: string[];
  expiresAt: number;
  createdAt: number;
}

export interface CacheSetOptions {
  ttlMs?: number;
  tags?: string[];
}
