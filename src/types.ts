/**
 * Public TypeScript definitions for react-native-sync-vault.
 */

export type {
  AuthContext,
  BackgroundDrainOptions,
  CachedValue,
  CacheSetOptions,
  Conflict,
  ConflictResolution,
  ConflictStrategy,
  EnqueueOptions,
  MergeFunction,
  NetworkState,
  PowerState,
  QueueCounts,
  RequestQuery,
  RequestState,
  SyncEvent,
  SyncEventType,
  SyncRequest,
  SyncVaultConfig,
} from './core/types';

// ---------------------------------------------------------------- interceptors

export interface InterceptorConfig {
  /** Intercept global fetch. */
  enabled?: boolean;
  /** Only URLs starting with one of these prefixes are queued. Empty means all. */
  urlFilter?: string[];
  /** Methods that are queued. Default POST, PUT, PATCH, DELETE. */
  methods?: string[];
  /** Queue when the network request fails even though the device reports online. Default true. */
  queueOnNetworkError?: boolean;
  axios?: {
    enabled?: boolean;
    instance?: unknown;
  };
}

// ---------------------------------------------------------------- cache

export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';

export interface EndpointCacheStrategy {
  /** TTL in seconds. */
  ttl?: number;
  staleWhileRevalidate?: boolean;
  strategy?: CacheStrategy;
}

/** e.g. { 'POST /api/todos': ['/api/todos', '/api/todos/*'] } */
export interface InvalidationConfig {
  [mutationPattern: string]: string[];
}

export interface CacheConfig {
  enabled?: boolean;
  /** Default TTL in seconds (default 3600). */
  defaultTtl?: number;
  /** Max cache size in bytes (default 50MB). */
  maxSize?: number;
  strategy?: CacheStrategy;
  strategies?: Record<string, EndpointCacheStrategy>;
  invalidateOnMutate?: InvalidationConfig;
}

export interface CacheResult<T = unknown> {
  hit: boolean;
  data?: T;
  stale?: boolean;
  /** Remaining TTL in ms. */
  ttl?: number;
}

// ---------------------------------------------------------------- v1 compatibility

/** @deprecated v1 states. Use RequestState. */
export type LegacyRequestStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

/** @deprecated Use ConflictStrategy. */
export type ConflictResolutionStrategy = 'client_wins' | 'server_wins' | 'manual_merge' | 'custom';

/** @deprecated Use EnqueueOptions with SyncVault.enqueue(). */
export interface QueuePushOptions {
  method: string;
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  priority?: number;
  maxRetries?: number;
  conflictResolution?: ConflictResolutionStrategy;
  customResolver?: (local: unknown, server: unknown) => unknown;
  metadata?: Record<string, unknown>;
}

/** @deprecated Use SyncVaultConfig. */
export interface OfflineQueueConfig {
  baseUrl?: string;
  interceptor?: InterceptorConfig;
  cache?: CacheConfig;
}
