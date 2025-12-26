import {
  QueuedRequest,
  RequestStatus,
  SyncStatus,
  FailureType,
  FailedRequest,
  ApiCallHandler,
  ApiCallRequest,
  ApiCallResponse,
} from './types';
import { calculateNextRetryAt, shouldRetry } from './utils/retryCalculator';
import { performanceTracker } from './utils/performance';
import QueueManager from './QueueManager';
import ConflictResolver from './ConflictResolver';
import NetworkMonitor from './NetworkMonitor';
import CacheManager from './cache/CacheManager';
import SmartCacheManager from './cache/SmartCacheManager';
import ResourceManager from './resources/ResourceManager';
import ResourceAwareSync from './sync/ResourceAwareSync';
import { ResourceAwareConfig } from './types';
import { getNativeModule } from './utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Sync Engine - Handles progressive synchronization of queued requests
 */
class SyncEngine {
  private queueManager: any;
  private networkMonitor: NetworkMonitor;
  private conflictResolver: ConflictResolver;
  private cacheManager: CacheManager | null = null;
  private smartCacheManager: SmartCacheManager | null = null;
  private resourceManager: ResourceManager | null = null;
  private resourceAwareSync: ResourceAwareSync | null = null;
  private isSyncing: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private baseUrl: string = '';
  private apiCallHandler?: ApiCallHandler;
  private resourceAwareConfig?: ResourceAwareConfig;

  constructor(
    queueManager: any,
    apiCallHandler?: ApiCallHandler,
    cacheManager?: CacheManager | null,
    resourceAwareConfig?: ResourceAwareConfig
  ) {
    this.queueManager = queueManager;
    this.networkMonitor = queueManager.getNetworkMonitor();
    this.conflictResolver = new ConflictResolver();
    this.apiCallHandler = apiCallHandler;
    this.cacheManager = cacheManager || null;
    this.resourceAwareConfig = resourceAwareConfig;
    
    // If cacheManager is SmartCacheManager, store reference
    if (cacheManager instanceof SmartCacheManager) {
      this.smartCacheManager = cacheManager;
    }
    
    // Initialize resource-aware sync if configured
    if (resourceAwareConfig) {
      this.resourceManager = new ResourceManager(
        this.networkMonitor,
        resourceAwareConfig
      );
      this.resourceAwareSync = new ResourceAwareSync(this.resourceManager);
    }
    
    this.setupNetworkListeners();
  }

  /**
   * Set cache manager
   */
  setCacheManager(cacheManager: CacheManager | null): void {
    this.cacheManager = cacheManager;
    
    // Check if it's a SmartCacheManager
    if (cacheManager instanceof SmartCacheManager) {
      this.smartCacheManager = cacheManager;
    } else {
      this.smartCacheManager = null;
    }
  }

  /**
   * Set custom API call handler
   */
  setApiCallHandler(handler: ApiCallHandler): void {
    this.apiCallHandler = handler;
  }

  /**
   * Setup network status listeners
   */
  private setupNetworkListeners(): void {
    this.networkMonitor.on('online', () => {
      this.startSync();
    });

    this.networkMonitor.on('offline', () => {
      this.stopSync();
    });
  }

  /**
   * Set base URL for API requests
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Start sync process
   */
  async startSync(): Promise<void> {
    const networkStatus = await Promise.resolve(this.networkMonitor.getStatus()).catch(() => 'unknown');
    const isOnline = await Promise.resolve(this.networkMonitor.isOnline()).catch(() => false);
    
    if (__DEV__) {
      console.log('[SYNC-ENGINE] Starting sync process:', { network: isOnline ? 'ONLINE' : 'OFFLINE' });
    }
    
    if (this.isSyncing || !isOnline) {
      if (__DEV__) {
        console.log('[SYNC-ENGINE] Sync skipped:', { 
          isSyncing: this.isSyncing, 
          isOnline 
        });
      }
      return;
    }

    this.isSyncing = true;

    // Emit sync started event
    if (this.queueManager && typeof this.queueManager.emit === 'function') {
      this.queueManager.emit('sync:started');
      if (__DEV__) {
        console.log('[EVENT] Emitting sync:started');
      }
    }

    try {
      const syncStatus = await NativeModule.getSyncStatus();
      const batchSize = syncStatus?.syncBatchSize || 5;
      const intervalMs = syncStatus?.syncIntervalMs || 1000;

      await NativeModule.updateSyncStatus({
        syncInProgress: 1,
        networkStatus: 'online',
      });

      // Process batches
      await this.processSyncBatches(batchSize, intervalMs);
    } catch (error) {
      if (__DEV__) {
        console.error('Sync error:', error);
      }
      if (NativeModule) {
        await NativeModule.updateSyncStatus({
          syncInProgress: 0,
          lastError: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
      // Emit sync failed event
      if (this.queueManager && typeof this.queueManager.emit === 'function') {
        this.queueManager.emit('sync:failed', { error });
        if (__DEV__) {
          console.log('[EVENT] Emitting sync:failed:', { error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Stop sync process
   */
  stopSync(): void {
    if (__DEV__) {
      console.log('[SYNC-ENGINE] Stopping sync process');
    }
    this.isSyncing = false;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Process sync batches
   */
  private async processSyncBatches(
    batchSize: number,
    intervalMs: number
  ): Promise<void> {
    let hasMore = true;

    while (hasMore && this.isSyncing && await Promise.resolve(this.networkMonitor.isOnline()).catch(() => false)) {
      const startTime = Date.now();
      let batch = await this.queueManager.getPendingRequests(batchSize, 0);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      if (__DEV__) {
        console.log('[SYNC-ENGINE] Processing batch:', { 
          batchSize: batch.length,
          originalBatchSize: batchSize 
        });
      }

      // Apply resource-aware filtering and sorting if enabled
      if (this.resourceAwareSync) {
        const originalLength = batch.length;
        batch = this.resourceAwareSync.filterRequests(batch);
        batch = this.resourceAwareSync.sortByPriority(batch);
        
        // Adjust batch size based on resources
        const adjustedBatchSize = this.resourceAwareSync.getBatchSize(batchSize);
        batch = batch.slice(0, adjustedBatchSize);
        
        if (__DEV__) {
          console.log('[SYNC-ENGINE] Resource-aware filtering:', { 
            original: originalLength,
            filtered: batch.length 
          });
        }
      }

      if (batch.length === 0) {
        // All requests filtered out, wait before retry
        await this.sleep(intervalMs);
        continue;
      }

      // Process batch concurrently
      const results = await Promise.allSettled(
        batch.map((request: QueuedRequest) => this.syncRequest(request))
      );
      
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const duration = Date.now() - startTime;

      performanceTracker.trackSync(startTime);
      await this.updateSyncStatusAfterBatch(batch.length);

      // Emit batch completed event
      if (this.queueManager && typeof this.queueManager.emit === 'function') {
        this.queueManager.emit('sync:batch:completed', { 
          batchSize: batch.length,
          duration 
        });
        
        if (__DEV__) {
          console.log('[SYNC-ENGINE] Batch completed:', { 
            successCount,
            totalCount: batch.length,
            duration: `${duration}ms` 
          });
          console.log('[EVENT] Emitting sync:batch:completed:', { 
            batchSize: batch.length,
            duration 
          });
        }
      }

      // Wait before next batch
      if (hasMore) {
        await this.sleep(intervalMs);
      }
    }

    // Mark sync as complete
    await NativeModule.updateSyncStatus({
      syncInProgress: 0,
      lastSyncAt: Date.now(),
    });

    // Emit sync completed event
    if (this.queueManager && typeof this.queueManager.emit === 'function') {
      this.queueManager.emit('sync:completed', { timestamp: Date.now() });
      if (__DEV__) {
        console.log('[EVENT] Emitting sync:completed:', { timestamp: Date.now() });
      }
    }
  }

  /**
   * Sync a single request
   */
  private async syncRequest(request: QueuedRequest): Promise<void> {
    if (__DEV__) {
      console.log('[SYNC-ENGINE] Syncing request:', { 
        requestId: request.id, 
        method: request.method, 
        url: request.url 
      });
    }
    try {
      // Update status to syncing
      await this.queueManager.updateRequestStatus(request.id, 'syncing', {
        lastAttemptAt: Date.now(),
        attemptCount: request.attemptCount + 1,
      });

      // Build full URL
      const url = this.buildUrl(request.url, request.queryParams);

      // Make API request
      const response = await this.makeRequest(
        request.method,
        url,
        request.headers,
        request.body,
        request.queryParams
      );

      // Handle response
      if (response.ok) {
        await this.handleSuccess(request, response);
      } else if (response.status === 409) {
        await this.handleConflict(request, response);
      } else {
        await this.handleError(request, response);
      }
      } catch (error) {
        if (__DEV__) {
          console.error('[SYNC-ENGINE] Request sync failed:', { 
            requestId: request.id, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      await this.handleNetworkError(request, error);
    }
  }

  /**
   * Make HTTP request
   * Uses custom apiCallHandler if provided, otherwise falls back to fetch()
   */
  private async makeRequest(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: any,
    queryParams?: Record<string, string>
  ): Promise<Response> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;

    // Use custom API call handler if provided
    if (this.apiCallHandler) {
      try {
        const request: ApiCallRequest = {
          method,
          url: fullUrl,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body,
          queryParams,
        };

        const customResponse = await this.apiCallHandler(request);
        const responseText = await customResponse.text();

        // Create a Response object that works with existing code
        const responseHeaders = new Headers();
        if (customResponse.headers) {
          Object.entries(customResponse.headers).forEach(([key, value]) => {
            responseHeaders.set(key, value);
          });
        }

        return new Response(responseText, {
          status: customResponse.status,
          statusText: customResponse.statusText,
          headers: responseHeaders,
        });
        } catch (error) {
          if (__DEV__) {
            console.error('Custom API handler error:', error);
          }
        throw error;
      }
    }

    // Fallback to default fetch() implementation

    const requestOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      return await fetch(fullUrl, requestOptions);
      } catch (error) {
        if (__DEV__) {
          console.error('Network request failed:', error);
        }
      throw error;
    }
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(url: string, queryParams?: Record<string, string>): string {
    if (!queryParams || Object.keys(queryParams).length === 0) {
      return url;
    }

    const params = new URLSearchParams(queryParams);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${params.toString()}`;
  }

  /**
   * Handle successful response
   */
  private async handleSuccess(
    request: QueuedRequest,
    response: Response
  ): Promise<void> {
    let responseData: any;
    try {
      const responseText = await response.text();
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = {};
      }
      } catch (error) {
        if (__DEV__) {
          console.error('Error reading response:', error);
        }
      responseData = {};
    }

    await this.queueManager.updateRequestStatus(request.id, 'synced', {
      serverResponse: responseData,
      syncedAt: Date.now(),
    });

    if (__DEV__) {
      console.log('[SYNC-ENGINE] Request synced successfully:', { requestId: request.id });
    }

    // Update data point if exists
    if (request.localDataId) {
      await NativeModule.updateDataPoint(request.id, {
        serverSnapshot: responseData,
        serverVersion: responseData.version || 1,
        dataStatus: 'synced',
      });
    }

    // Update sync status
    await this.incrementSyncCounter();
    
    // Cache successful GET requests
    if (this.cacheManager?.isEnabled() && request.method === 'GET') {
      try {
        const cacheKey = this.buildUrl(request.url, request.queryParams);
        const endpoint = request.url.split('?')[0]; // Remove query params for endpoint matching
        
        if (this.smartCacheManager) {
          // Use smart cache with endpoint-specific TTL
          await this.smartCacheManager.set(cacheKey, responseData, {
            endpoint,
          });
        } else {
          // Fallback to regular cache
          await this.cacheManager.set(cacheKey, responseData, {
            ttl: 3600, // Default 1 hour
          });
        }
      } catch (error) {
        // Cache failures are non-critical
      }
    }
    
    // Invalidate cache on successful mutations (POST, PUT, DELETE)
    if (this.smartCacheManager && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      try {
        const url = this.buildUrl(request.url, request.queryParams);
        await this.smartCacheManager.invalidateOnMutate(request.method, url);
      } catch (error) {
        // Invalidation failures are non-critical
      }
    }
  }

  /**
   * Handle conflict response
   */
  private async handleConflict(
    request: QueuedRequest,
    response: Response
  ): Promise<void> {
    const responseData = await response.json().catch(() => ({}));

    // Get local snapshot from request body
    const localSnapshotData = request.body || {};
    
    // Try to get data points from native module if available
    let dataPoints: any[] = [];
    try {
      if (request.localDataId && NativeModule) {
        // Note: This would require a method to get data points by request ID
        // For now, use request body as local snapshot
      }
    } catch (e) {
      // Ignore errors
    }

    const localSnapshot = dataPoints?.[0]?.localSnapshot || request.body;

    // Store conflict
    const conflictData = {
      local: localSnapshot,
      server: responseData,
      detectedAt: Date.now(),
    };

    await this.queueManager.updateRequestStatus(request.id, 'conflict', {
      conflictData,
    });

    // Try to resolve conflict
    try {
      const resolution = this.conflictResolver.getResolutionStrategy(request);
      const resolved = await this.conflictResolver.resolveConflict(
        localSnapshotData,
        responseData,
        { strategy: resolution }
      );

      if (resolution !== 'manual_merge' && !resolved.requiresManualResolution) {
        // Retry with resolved data
        await this.queueManager.updateRequestStatus(request.id, 'pending', {
          body: resolved,
          conflictData: null,
        });
      }
      } catch (error) {
        if (__DEV__) {
          console.error('Conflict resolution error:', error);
        }
    }
  }

  /**
   * Handle error response
   */
  private async handleError(
    request: QueuedRequest,
    response: Response
  ): Promise<void> {
    const errorData = await response.text().catch(() => '');
    const failureType = this.categorizeError(response.status);

    if (__DEV__) {
      console.log('[SYNC-ENGINE] Request sync failed:', { 
        requestId: request.id, 
        status: response.status,
        failureType,
        error: errorData.substring(0, 100) // Limit error message length
      });
    }

    const shouldRetryRequest = shouldRetry(
      failureType,
      request.attemptCount + 1,
      request.maxRetries
    );

    if (shouldRetryRequest) {
      const retryAfter = calculateNextRetryAt(request.attemptCount + 1);
      await this.queueManager.updateRequestStatus(request.id, 'failed', {
        retryAfter,
      });

      // Store in failed_requests
      await this.storeFailedRequest(request, failureType, errorData, true);
    } else {
      // Permanent failure
      await this.queueManager.updateRequestStatus(request.id, 'failed', {});
      await this.storeFailedRequest(request, failureType, errorData, false);
    }
  }

  /**
   * Handle network error
   */
  private async handleNetworkError(
    request: QueuedRequest,
    error: any
  ): Promise<void> {
    const failureType: FailureType = 'network';
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (__DEV__) {
      console.log('[SYNC-ENGINE] Network error during sync:', { 
        requestId: request.id, 
        error: errorMessage 
      });
    }

    const shouldRetryRequest = shouldRetry(
      failureType,
      request.attemptCount + 1,
      request.maxRetries
    );

    if (shouldRetryRequest) {
      const retryAfter = calculateNextRetryAt(request.attemptCount + 1);
      await this.queueManager.updateRequestStatus(request.id, 'failed', {
        retryAfter,
      });
      await this.storeFailedRequest(request, failureType, errorMessage, true);
    } else {
      await this.queueManager.updateRequestStatus(request.id, 'failed', {});
      await this.storeFailedRequest(request, failureType, errorMessage, false);
    }
  }

  /**
   * Categorize error by HTTP status code
   */
  private categorizeError(statusCode: number): FailureType {
    if (statusCode >= 500) {
      return 'server';
    } else if (statusCode === 409) {
      return 'conflict';
    } else if (statusCode >= 400) {
      return 'validation';
    } else {
      return 'unknown';
    }
  }

  /**
   * Store failed request
   */
  private async storeFailedRequest(
    request: QueuedRequest,
    failureType: FailureType,
    errorMessage: string,
    willRetry: boolean
  ): Promise<void> {
    try {
      const failedRequest: Omit<FailedRequest, 'id' | 'createdAt' | 'updatedAt'> = {
        requestId: request.id,
        errorMessage,
        failureType,
        willRetry,
        isPermanent: !willRetry,
        nextRetryAt: willRetry ? calculateNextRetryAt(request.attemptCount) : undefined,
      };

      // Store failed request - this would be handled by native module
      // For now, we'll update the request status which includes failure info
      const failedRequestData = {
        errorMessage,
        failureType,
        willRetry,
        isPermanent: !willRetry,
        nextRetryAt: willRetry ? calculateNextRetryAt(request.attemptCount) : undefined,
      };
      
      // The native module should handle storing in failed_requests table
      // This is a simplified version - in production, you'd have a dedicated method
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to store failed request:', error);
        }
    }
  }

  /**
   * Update sync status after batch
   */
  private async updateSyncStatusAfterBatch(batchSize: number): Promise<void> {
    try {
      const syncStatus = await NativeModule.getSyncStatus();
      await NativeModule.updateSyncStatus({
        totalSynced: (syncStatus?.totalSynced || 0) + batchSize,
      });
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to update sync status:', error);
        }
    }
  }

  /**
   * Increment sync counter
   */
  private async incrementSyncCounter(): Promise<void> {
    try {
      const syncStatus = await NativeModule.getSyncStatus();
      await NativeModule.updateSyncStatus({
        totalSynced: (syncStatus?.totalSynced || 0) + 1,
      });
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to increment sync counter:', error);
        }
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default SyncEngine;

