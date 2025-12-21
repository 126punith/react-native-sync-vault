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
  enabled?: boolean;                    // Opt-in flag
  urlFilter?: string[];                 // Simple allow list (URLs must start with these)
}

/**
 * Configuration options for offline queue
 */
export interface OfflineQueueConfig {
  apiCallHandler?: ApiCallHandler;
  baseUrl?: string;
  interceptor?: InterceptorConfig;      // Automatic API interception config
}


