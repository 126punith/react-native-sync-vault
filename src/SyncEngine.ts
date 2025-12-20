import { NativeModules } from 'react-native';
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

// Get native module with error handling
let NativeModule: any = null;
try {
  NativeModule = NativeModules.OfflineQueue;
  if (!NativeModule) {
    console.warn('OfflineQueue native module not found in SyncEngine. Some features may not work.');
  }
} catch (error) {
  console.warn('Failed to access native module in SyncEngine:', error);
}

/**
 * Sync Engine - Handles progressive synchronization of queued requests
 */
class SyncEngine {
  private queueManager: any;
  private networkMonitor: NetworkMonitor;
  private conflictResolver: ConflictResolver;
  private isSyncing: boolean = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private baseUrl: string = '';
  private apiCallHandler?: ApiCallHandler;

  constructor(queueManager: any, apiCallHandler?: ApiCallHandler) {
    this.queueManager = queueManager;
    this.networkMonitor = queueManager.getNetworkMonitor();
    this.conflictResolver = new ConflictResolver();
    this.apiCallHandler = apiCallHandler;
    this.setupNetworkListeners();
  }

  /**
   * Set custom API call handler
   */
  setApiCallHandler(handler: ApiCallHandler): void {
    this.apiCallHandler = handler;
    console.log('[DEBUG] SyncEngine.setApiCallHandler() custom handler set');
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
    console.log('[DEBUG] SyncEngine.startSync() entry, isSyncing:', this.isSyncing, 'networkStatus:', networkStatus, 'isOnline:', isOnline);
    if (this.isSyncing) {
      console.log('[DEBUG] SyncEngine.startSync() already syncing, returning');
      return;
    }

    if (!isOnline) {
      console.log('[DEBUG] SyncEngine.startSync() not online, networkStatus:', networkStatus);
      return;
    }

    this.isSyncing = true;

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
      console.error('Sync error:', error);
      await NativeModule.updateSyncStatus({
        syncInProgress: 0,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Stop sync process
   */
  stopSync(): void {
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
      const batch = await this.queueManager.getPendingRequests(batchSize, 0);
      console.log('[DEBUG] processSyncBatches() got batch:', {
        batchSize: batch.length,
        expectedBatchSize: batchSize,
        requests: batch.map((r: any) => ({
          id: r.id,
          method: r.method,
          url: r.url,
          status: r.status
        }))
      });

      if (batch.length === 0) {
        console.log('[DEBUG] processSyncBatches() no more requests, breaking loop');
        hasMore = false;
        break;
      }

      // Process batch concurrently
      console.log('[DEBUG] processSyncBatches() processing batch of', batch.length, 'requests');
      console.log('[DEBUG] processSyncBatches() calling Promise.allSettled with', batch.length, 'syncRequest calls');
      
      const results = await Promise.allSettled(
        batch.map((request: QueuedRequest) => {
          console.log('[DEBUG] processSyncBatches() mapping request to syncRequest:', request.id);
          return this.syncRequest(request);
        })
      );
      
      console.log('[DEBUG] processSyncBatches() Promise.allSettled completed:', {
        total: results.length,
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        results: results.map((r, i) => ({
          index: i,
          status: r.status,
          value: r.status === 'fulfilled' ? 'success' : (r.reason?.message || String(r.reason)),
          requestId: batch[i]?.id
        }))
      });

      performanceTracker.trackSync(startTime);

      // Update sync status
      console.log('[DEBUG] processSyncBatches() updating sync status after batch');
      await this.updateSyncStatusAfterBatch(batch.length);
      console.log('[DEBUG] processSyncBatches() batch completed, processed', batch.length, 'requests');

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
  }

  /**
   * Sync a single request
   */
  private async syncRequest(request: QueuedRequest): Promise<void> {
    console.log('[DEBUG] syncRequest() entry:', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      status: request.status,
      attemptCount: request.attemptCount,
      maxRetries: request.maxRetries,
      hasBody: !!request.body,
      hasHeaders: !!request.headers && Object.keys(request.headers).length > 0,
      hasQueryParams: !!request.queryParams && Object.keys(request.queryParams).length > 0
    });

    try {
      // Update status to syncing
      console.log('[DEBUG] syncRequest() updating status to syncing for request:', request.id);
      await this.queueManager.updateRequestStatus(request.id, 'syncing', {
        lastAttemptAt: Date.now(),
        attemptCount: request.attemptCount + 1,
      });

      // Build full URL
      const url = this.buildUrl(request.url, request.queryParams);
      console.log('[DEBUG] syncRequest() built full URL:', {
        originalUrl: request.url,
        fullUrl: url,
        hasQueryParams: !!request.queryParams && Object.keys(request.queryParams).length > 0,
        queryParams: request.queryParams
      });

      // Log request data being sent
      console.log('[DEBUG] syncRequest() request data:', {
        method: request.method,
        url: url,
        headers: request.headers || {},
        body: request.body ? {
          preview: JSON.stringify(request.body).substring(0, 200),
          length: JSON.stringify(request.body).length,
          type: typeof request.body
        } : null
      });

      // Make API request
      console.log('[DEBUG] syncRequest() calling makeRequest()...');
      const response = await this.makeRequest(
        request.method,
        url,
        request.headers,
        request.body,
        request.queryParams
      );
      
      // Convert headers to object
      const headersObj: Record<string, string> = {};
      if (response.headers && typeof response.headers.forEach === 'function') {
        response.headers.forEach((value: string, key: string) => {
          headersObj[key] = value;
        });
      } else if (response.headers && typeof (response.headers as any).entries === 'function') {
        try {
          Object.assign(headersObj, Object.fromEntries((response.headers as any).entries()));
        } catch (e) {
          // Fallback if entries() not available
        }
      }

      console.log('[DEBUG] syncRequest() received response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: headersObj
      });

      // Handle response
      if (response.ok) {
        console.log('[DEBUG] syncRequest() response is OK, calling handleSuccess()');
        await this.handleSuccess(request, response);
      } else if (response.status === 409) {
        console.log('[DEBUG] syncRequest() conflict detected (409), calling handleConflict()');
        await this.handleConflict(request, response);
      } else {
        console.log('[DEBUG] syncRequest() error response:', {
          status: response.status,
          statusText: response.statusText
        });
        await this.handleError(request, response);
      }
    } catch (error) {
      console.error('[DEBUG] syncRequest() exception caught:', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined
      });
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
    
    console.log('[DEBUG] makeRequest() entry:', {
      method,
      url,
      fullUrl,
      hasBody: !!body,
      bodySize: body ? JSON.stringify(body).length : 0,
      headers: Object.keys(headers),
      baseUrl: this.baseUrl,
      hasCustomHandler: !!this.apiCallHandler
    });

    // Use custom API call handler if provided
    if (this.apiCallHandler) {
      console.log('[DEBUG] makeRequest() using custom apiCallHandler');
      const startTime = Date.now();
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

        console.log('[DEBUG] makeRequest() calling custom handler with request:', {
          method: request.method,
          url: request.url,
          headers: request.headers,
          hasBody: !!request.body,
          hasQueryParams: !!request.queryParams
        });

        const customResponse = await this.apiCallHandler(request);
        const duration = Date.now() - startTime;

        console.log('[DEBUG] makeRequest() custom handler completed:', {
          status: customResponse.status,
          statusText: customResponse.statusText,
          ok: customResponse.ok,
          duration: `${duration}ms`,
          hasHeaders: !!customResponse.headers
        });

        // Convert ApiCallResponse to fetch Response-like object
        // We need to create a Response object that matches the fetch API
        const responseText = await customResponse.text();
        
        console.log('[DEBUG] makeRequest() custom handler response text:', {
          status: customResponse.status,
          ok: customResponse.ok,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 200)
        });

        // Create a Response object that works with existing code
        const responseHeaders = new Headers();
        if (customResponse.headers) {
          Object.entries(customResponse.headers).forEach(([key, value]) => {
            responseHeaders.set(key, value);
          });
        }

        const response = new Response(responseText, {
          status: customResponse.status,
          statusText: customResponse.statusText,
          headers: responseHeaders,
        });

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error('[DEBUG] makeRequest() custom handler error:', {
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          duration: `${duration}ms`,
          url: fullUrl,
          method
        });
        throw error;
      }
    }

    // Fallback to default fetch() implementation
    console.log('[DEBUG] makeRequest() using default fetch() implementation');

    const requestOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestOptions.body = JSON.stringify(body);
      console.log('[DEBUG] makeRequest() request body:', {
        bodyPreview: JSON.stringify(body).substring(0, 200),
        bodyLength: JSON.stringify(body).length
      });
    }

    console.log('[DEBUG] makeRequest() request options:', {
      method: requestOptions.method,
      headers: requestOptions.headers,
      hasBody: !!requestOptions.body,
      bodyLength: requestOptions.body ? String(requestOptions.body).length : 0
    });

    console.log('[DEBUG] makeRequest() calling fetch() with URL:', fullUrl);
    const startTime = Date.now();
    
    try {
      const response = await fetch(fullUrl, requestOptions);
      const duration = Date.now() - startTime;
      
      console.log('[DEBUG] makeRequest() fetch() completed:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        duration: `${duration}ms`,
        headers: (() => {
          const headersObj: Record<string, string> = {};
          if (response.headers && typeof response.headers.forEach === 'function') {
            response.headers.forEach((value: string, key: string) => {
              headersObj[key] = value;
            });
          } else if (response.headers && typeof (response.headers as any).entries === 'function') {
            try {
              Object.assign(headersObj, Object.fromEntries((response.headers as any).entries()));
            } catch (e) {
              // Fallback if entries() not available
            }
          }
          return headersObj;
        })()
      });

      // Log response body preview (first 200 chars)
      try {
        const responseClone = response.clone();
        const text = await responseClone.text();
        console.log('[DEBUG] makeRequest() response body preview:', {
          bodyPreview: text.substring(0, 200),
          bodyLength: text.length,
          isJSON: text.trim().startsWith('{') || text.trim().startsWith('[')
        });
      } catch (parseError) {
        console.log('[DEBUG] makeRequest() could not parse response body:', parseError);
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('[DEBUG] makeRequest() fetch() error:', {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        duration: `${duration}ms`,
        url: fullUrl,
        method
      });
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
    console.log('[DEBUG] handleSuccess() entry:', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      responseStatus: response.status,
      responseStatusText: response.statusText
    });

    let responseData: any;
    try {
      const responseText = await response.text();
      console.log('[DEBUG] handleSuccess() response text:', {
        textLength: responseText.length,
        textPreview: responseText.substring(0, 200),
        isJSON: responseText.trim().startsWith('{') || responseText.trim().startsWith('[')
      });
      
      try {
        responseData = JSON.parse(responseText);
        console.log('[DEBUG] handleSuccess() parsed JSON response:', {
          hasData: !!responseData,
          dataKeys: responseData && typeof responseData === 'object' ? Object.keys(responseData) : [],
          dataPreview: JSON.stringify(responseData).substring(0, 200)
        });
      } catch (parseError) {
        console.log('[DEBUG] handleSuccess() response is not JSON, using empty object');
        responseData = {};
      }
    } catch (error) {
      console.error('[DEBUG] handleSuccess() error reading response:', error);
      responseData = {};
    }

    console.log('[DEBUG] handleSuccess() updating request status to synced:', {
      requestId: request.id,
      responseDataSize: JSON.stringify(responseData).length
    });

    await this.queueManager.updateRequestStatus(request.id, 'synced', {
      serverResponse: responseData,
      syncedAt: Date.now(),
    });

    // Update data point if exists
    if (request.localDataId) {
      console.log('[DEBUG] handleSuccess() updating data point:', {
        requestId: request.id,
        localDataId: request.localDataId,
        serverVersion: responseData.version || 1
      });
      await NativeModule.updateDataPoint(request.id, {
        serverSnapshot: responseData,
        serverVersion: responseData.version || 1,
        dataStatus: 'synced',
      });
    } else {
      console.log('[DEBUG] handleSuccess() no localDataId, skipping data point update');
    }

    // Update sync status
    console.log('[DEBUG] handleSuccess() incrementing sync counter');
    await this.incrementSyncCounter();
    
    console.log('[DEBUG] handleSuccess() completed successfully for request:', request.id);
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
      console.error('Conflict resolution error:', error);
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
      console.log('Failed request stored:', failedRequestData);
    } catch (error) {
      console.error('Failed to store failed request:', error);
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
      console.warn('Failed to update sync status:', error);
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
      console.warn('Failed to increment sync counter:', error);
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

