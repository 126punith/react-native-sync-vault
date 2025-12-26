/**
 * Core TypeScript definitions for react-native-sync-vault
 */

export type RequestStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

export type FailureType = 'network' | 'server' | 'timeout' | 'validation' | 'conflict' | 'unknown';

export type ConflictResolutionStrategy = 'client_wins' | 'server_wins' | 'manual_merge' | 'custom';

export interface QueuedRequest {
  id: string;
  requestId?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
  status: RequestStatus;
  priority: number;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt?: number;
  syncedAt?: number;
  attemptCount: number;
  maxRetries: number;
  retryAfter?: number;
  localDataId?: string;
  serverResponse?: any;
  conflictData?: any;
  conflictResolution?: ConflictResolutionStrategy;
  metadata?: Record<string, any>;
}

export interface SyncStatus {
  id: number;
  lastSyncAt?: number;
  syncInProgress: boolean;
  totalPending: number;
  totalFailed: number;
  lastError?: string;
  networkStatus: NetworkStatus;
  syncBatchSize: number;
  syncIntervalMs: number;
  totalSynced: number;
  totalErrors: number;
  updatedAt: number;
}

export interface SyncDataPoint {
  id: string;
  requestId: string;
  dataType: string;
  tableName?: string;
  localId?: string;
  serverId?: string;
  localSnapshot: any;
  serverSnapshot?: any;
  localVersion: number;
  serverVersion?: number;
  dataStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface FailedRequest {
  id: string;
  requestId: string;
  errorCode?: string;
  errorMessage: string;
  errorDetails?: any;
  willRetry: boolean;
  nextRetryAt?: number;
  failureType: FailureType;
  isPermanent: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface QueuePushOptions {
  method: string;
  url: string;
  data?: any;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  priority?: number;
  maxRetries?: number;
  conflictResolution?: ConflictResolutionStrategy;
  customResolver?: (local: any, server: any) => any;
  metadata?: Record<string, any>;
}

export interface ConflictResolution {
  strategy: ConflictResolutionStrategy;
  customResolver?: (local: any, server: any) => any;
}

export interface BatchQuery {
  query: string;
  params: any[];
}

export interface PerformanceMetrics {
  initializationTime: number;
  memoryOverhead: number;
  averageEnqueueTime: number;
  averageSyncTime: number;
  totalRequestsProcessed: number;
  totalSyncOperations: number;
}

export interface NativeModule {
  // Database operations
  executeSql(query: string, params: any[]): Promise<any>;
  executeBatch(queries: BatchQuery[]): Promise<any[]>;
  
  // Request operations
  insertRequest(request: Omit<QueuedRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  updateRequestStatus(id: string, status: RequestStatus, data?: any): Promise<void>;
  getPendingRequests(limit: number, offset: number): Promise<QueuedRequest[]>;
  getFailedRequests(): Promise<FailedRequest[]>;
  
  // Sync operations
  getSyncStatus(): Promise<SyncStatus>;
  updateSyncStatus(updates: Partial<SyncStatus>): Promise<void>;
  
  // Data point operations
  insertDataPoint(dataPoint: Omit<SyncDataPoint, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  updateDataPoint(requestId: string, updates: Partial<SyncDataPoint>): Promise<void>;
  
  // Performance metrics
  getPerformanceMetrics(): Promise<PerformanceMetrics>;
  resetPerformanceMetrics(): Promise<void>;
}

/**
 * Standard response interface for API call handlers
 * Compatible with fetch() Response but allows custom implementations
 */
export interface ApiCallResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<any>;
  text: () => Promise<string>;
  headers?: Record<string, string>;
}

/**
 * Request data passed to API call handler
 */
export interface ApiCallRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
}

/**
 * Custom API call handler function
 * Allows users to use their own HTTP clients (axios, custom fetch wrappers, etc.)
 */
export type ApiCallHandler = (request: ApiCallRequest) => Promise<ApiCallResponse>;

/**
 * Configuration for automatic API interception
 */
export interface InterceptorConfig {
  enabled?: boolean;                    // Opt-in flag for fetch interception
  urlFilter?: string[];                 // Simple allow list (URLs must start with these)
  axios?: {
    enabled?: boolean;                   // Enable axios interception
    instance?: any;                     // Custom axios instance (optional, uses default if not provided)
  };
}

/**
 * Resource-aware configuration
 */
export interface ResourceAwareConfig {
  battery?: {
    lowThreshold?: number; // Percentage (default: 20)
    action?: 'defer_non_critical' | 'pause' | 'continue'; // Action when low
    criticalOnly?: boolean; // Only sync critical items when low
  };
  network?: {
    qualityAware?: boolean; // Detect network quality
    deferLargeUploadsOnCellular?: boolean; // Defer large uploads on cellular
    minQualityForLargeUploads?: 'unknown' | 'poor' | 'fair' | 'good' | 'excellent'; // Minimum quality
    maxPayloadSizeOnCellular?: number; // Max payload size on cellular (bytes)
  };
  storage?: {
    maxCacheSize?: number; // Max cache size in bytes
    cleanupOnLowStorage?: boolean; // Cleanup when storage is low
  };
}

/**
 * Configuration options for offline queue
 */
export interface OfflineQueueConfig {
  apiCallHandler?: ApiCallHandler;
  baseUrl?: string;
  interceptor?: InterceptorConfig;      // Automatic API interception config
  cache?: CacheConfig;                  // Cache configuration
  resourceAware?: ResourceAwareConfig;  // Resource-aware sync configuration
}

/**
 * Cache entry stored in database
 */
export interface CacheEntry {
  id: string;
  key: string;                          // Cache key (usually URL)
  value: string;                        // JSON stringified response
  ttl: number;                          // Time to live (timestamp)
  tags?: string;                        // Comma-separated tags for invalidation
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;               // For LRU eviction
  size: number;                         // Size in bytes
}

/**
 * Per-endpoint cache strategy
 */
export interface EndpointCacheStrategy {
  ttl?: number;                        // TTL in seconds for this endpoint
  staleWhileRevalidate?: boolean;      // Use stale-while-revalidate for this endpoint
  strategy?: CacheStrategy;            // Override default strategy for this endpoint
}

/**
 * Cache invalidation configuration
 */
export interface InvalidationConfig {
  [mutationPattern: string]: string[]; // e.g., 'POST /api/assignments': ['/api/assignments', '/api/assignments/*']
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled?: boolean;                    // Enable caching
  defaultTtl?: number;                  // Default TTL in seconds (default: 3600)
  maxSize?: number;                     // Max cache size in bytes (default: 50MB)
  strategy?: CacheStrategy;            // Cache strategy (default: 'network-first')
  invalidateOnError?: boolean;         // Invalidate cache on error (default: false)
  strategies?: Record<string, EndpointCacheStrategy>; // Per-endpoint strategies
  invalidateOnMutate?: InvalidationConfig; // Invalidation rules for mutations
}

/**
 * Cache strategy type
 */
export type CacheStrategy = 
  | 'cache-first'                      // Check cache first, fallback to network
  | 'network-first'                    // Try network first, fallback to cache
  | 'stale-while-revalidate';          // Return cache immediately, refresh in background

/**
 * Cache result
 */
export interface CacheResult {
  hit: boolean;                         // Whether cache hit
  data?: any;                          // Cached data (if hit)
  stale?: boolean;                     // Whether cache is stale
  ttl?: number;                        // Remaining TTL
}


