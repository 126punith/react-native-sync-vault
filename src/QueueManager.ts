import {
  QueuedRequest,
  QueuePushOptions,
  RequestStatus,
  SyncDataPoint,
  InterceptorConfig,
} from './types';
import { generateRequestId } from './utils/idGenerator';
import { performanceTracker } from './utils/performance';
import { getNativeModule } from './utils/nativeModule';
import { EventEmitter } from './utils/EventEmitter';

// Lazy import NetworkMonitor to avoid evaluation errors
let NetworkMonitorClass: any = null;
function getNetworkMonitorClass() {
  if (!NetworkMonitorClass) {
    try {
      const networkMonitorModule = require('./NetworkMonitor');
      NetworkMonitorClass = networkMonitorModule.default;
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to load NetworkMonitor class:', error);
      }
      return null;
    }
  }
  return NetworkMonitorClass;
}

// Get native module
const NativeModule = getNativeModule();

/**
 * Queue Manager - Main class for managing offline request queue
 */
class QueueManager extends EventEmitter {
  private networkMonitor: any;
  private isInitialized: boolean = false;
  private apiInterceptor: any = null;
  private axiosInterceptor: any = null;

  constructor() {
    super(); // Call EventEmitter constructor
    try {
      const NetworkMonitorClass = getNetworkMonitorClass();
      if (NetworkMonitorClass) {
        this.networkMonitor = new NetworkMonitorClass();
      } else {
        throw new Error('NetworkMonitor class not available');
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to create NetworkMonitor, using stub:', error);
      }
      // Create a simple stub NetworkMonitor
      let stubStatus: 'online' | 'offline' | 'unknown' = 'unknown';
      this.networkMonitor = {
        _lastStatus: 'unknown',
        getStatus: () => stubStatus,
        isOnline: () => false,
        isOffline: () => true,
        refreshStatus: async () => {
          if (NativeModule) {
            try {
              const status = await NativeModule.getNetworkStatus();
              if (status === 'online') {
                stubStatus = 'online';
              } else if (status === 'offline') {
                stubStatus = 'offline';
              } else {
                stubStatus = 'unknown';
              }
              this.networkMonitor._lastStatus = stubStatus;
            } catch (e) {
              // Method might not exist
            }
          }
        },
        destroy: () => {},
        on: () => this.networkMonitor,
        off: () => this.networkMonitor,
        emit: () => false,
        removeAllListeners: () => this.networkMonitor,
        listenerCount: () => 0,
      } as any;
    }
  }

  /**
   * Initialize the queue manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const startTime = Date.now();
    
    // Initialize sync status if needed
    if (NativeModule) {
      try {
        const syncStatus = await NativeModule.getSyncStatus();
        if (!syncStatus || Object.keys(syncStatus).length === 0) {
          // Sync status will be initialized by database schema
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to get sync status during initialization:', error);
        }
      }
    } else {
      // Warning already shown at module load, no need to repeat
    }

    this.isInitialized = true;
    performanceTracker.trackInitialization(startTime);
  }

  /**
   * Push a request to the queue (Primary API)
   */
  async push(options: QueuePushOptions): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const id = generateRequestId();
    const now = Date.now();

    // Build request object - native module expects 'id' and 'requestId' fields
    const request: any = {
      id: id, // Primary ID for the request
      requestId: options.url + '_' + now, // Deduplication key
      method: options.method.toUpperCase(),
      url: options.url,
      headers: options.headers || {},
      body: options.data,
      queryParams: options.queryParams,
      status: 'pending' as RequestStatus,
      priority: options.priority || 0,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      maxRetries: options.maxRetries || 3,
      conflictResolution: options.conflictResolution || 'manual_merge',
      metadata: options.metadata,
    };

    try {
      if (!NativeModule) {
        throw new Error(
          'Native module not available. The offline queue requires the native module to persist requests. ' +
          'Please ensure react-native-sync-vault native module is properly linked and the app is rebuilt.'
        );
      }
      
      // Insert request into database
      const id = await NativeModule.insertRequest(request);
      
      // Store data point if body exists
      if (options.data && NativeModule) {
        try {
          const dataPoint: Omit<SyncDataPoint, 'id' | 'createdAt' | 'updatedAt'> = {
            requestId: id,
            dataType: 'request_body',
            localSnapshot: options.data,
            dataStatus: 'pending',
            localVersion: 1,
          };
          await NativeModule.insertDataPoint(dataPoint);
        } catch (error) {
          if (__DEV__) {
            console.warn('Failed to insert data point:', error);
          }
        }
      }

      // Update sync status
      await this.updateSyncStatusCounters();

      // Emit event for new request
      this.emit('queue:request:added', { requestId: id, request });
      
      if (__DEV__) {
        console.log('[EVENT] Emitting queue:request:added:', { 
          requestId: id, 
          method: request.method, 
          url: request.url 
        });
      }

      // If online, trigger immediate sync attempt (non-blocking)
      // Try to refresh status first if it's unknown and refreshStatus is available
      if (this.networkMonitor.getStatus() === 'unknown' && typeof this.networkMonitor.refreshStatus === 'function') {
        this.networkMonitor.refreshStatus().then(() => {
          if (this.networkMonitor.isOnline()) {
            this.triggerSync().catch((error) => {
              if (__DEV__) {
                console.warn('Failed to trigger immediate sync:', error);
              }
            });
          }
        }).catch(() => {
          // Fall back to checking current status
          if (this.networkMonitor.isOnline()) {
            this.triggerSync().catch(() => {});
          }
        });
      } else {
        if (this.networkMonitor.isOnline()) {
          this.triggerSync().catch((error) => {
            if (__DEV__) {
              console.warn('Failed to trigger immediate sync:', error);
            }
          });
        }
      }

      performanceTracker.trackEnqueue(startTime);
      return id;
    } catch (error) {
      console.error('Failed to queue request:', error);
      throw error;
    }
  }

  /**
   * Get pending requests
   */
  async getPendingRequests(limit: number = 10, offset: number = 0): Promise<QueuedRequest[]> {
    if (!NativeModule) {
      // Silently return empty array - warning already shown at module load
      return [];
    }
    try {
      const result = await NativeModule.getPendingRequests(limit, offset);
      return result;
    } catch (error) {
      console.error('Failed to get pending requests:', error);
      throw error;
    }
  }

  /**
   * Get failed requests
   */
  async getFailedRequests(): Promise<any[]> {
    if (!NativeModule) {
      // Silently return empty array - warning already shown at module load
      return [];
    }
    try {
      return await NativeModule.getFailedRequests();
    } catch (error) {
      console.error('Failed to get failed requests:', error);
      throw error;
    }
  }

  /**
   * Update request status
   */
  async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    data?: any
  ): Promise<void> {
    if (!NativeModule) {
      throw new Error('Native module not available');
    }
    try {
      await NativeModule.updateRequestStatus(requestId, status, data || {});
      
      // Emit request status change events
      if (__DEV__) {
        console.log('[EVENT] Emitting queue:status:changed:', { requestId, status });
      }
      
      if (status === 'synced') {
        this.emit('queue:request:synced', { requestId, data });
        if (__DEV__) {
          console.log('[EVENT] Emitting queue:request:synced:', { requestId });
        }
      } else if (status === 'failed') {
        this.emit('queue:request:failed', { requestId, data });
        if (__DEV__) {
          console.log('[EVENT] Emitting queue:request:failed:', { requestId });
        }
      }
      
      await this.updateSyncStatusCounters();
    } catch (error) {
      console.error('Failed to update request status:', error);
      throw error;
    }
  }

  /**
   * Update sync status counters
   */
  private async updateSyncStatusCounters(): Promise<void> {
    if (!NativeModule) {
      return;
    }
    try {
      // Get current counts
      const pending = await this.getPendingRequests(1000, 0);
      const failed = await this.getFailedRequests();

      const status = {
        totalPending: pending.length,
        totalFailed: failed.length,
        networkStatus: this.networkMonitor.getStatus(),
      };

      await NativeModule.updateSyncStatus(status);

      // Emit status change event
      this.emit('queue:status:changed', status);
      this.emit('queue:pending:changed', pending);
      this.emit('queue:failed:changed', failed);
      
      if (__DEV__) {
        console.log('[EVENT] Emitting queue:pending:changed:', { count: pending.length });
        console.log('[EVENT] Emitting queue:failed:changed:', { count: failed.length });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to update sync status counters:', error);
      }
    }
  }

  /**
   * Check if native module is available
   */
  isNativeModuleAvailable(): boolean {
    return NativeModule !== null;
  }

  /**
   * Trigger sync (called by sync engine)
   */
  async triggerSync(): Promise<void> {
    // This will be handled by SyncEngine
    // Placeholder for now
  }

  /**
   * Get network monitor instance
   */
  getNetworkMonitor(): any {
    return this.networkMonitor;
  }

  /**
   * Static method to get network monitor (for hooks)
   */
  static getNetworkMonitor(): any {
    return queueManager.networkMonitor;
  }

  /**
   * Enable automatic API interception
   */
  enableAutoInterception(config: InterceptorConfig): void {
    if (__DEV__) {
      console.log('[AUTO-DETECT] Enabling auto-interception:', { 
        fetch: config.enabled || false,
        axios: config.axios?.enabled || false 
      });
    }
    
    // Enable fetch interception
    if (config.enabled) {
      try {
        if (!this.apiInterceptor) {
          const ApiInterceptorClass = require('./ApiInterceptor').default;
          this.apiInterceptor = new ApiInterceptorClass();
        }
        this.apiInterceptor.enable(config, this);
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to enable fetch interception:', error);
        }
      }
    }

    // Enable axios interception
    if (config.axios?.enabled) {
      try {
        if (!this.axiosInterceptor) {
          const AxiosInterceptorClass = require('./AxiosInterceptor').default;
          this.axiosInterceptor = new AxiosInterceptorClass();
        }
        this.axiosInterceptor.enable(config, this, config.axios.instance);
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to enable axios interception:', error);
        }
      }
    }
    
    if (__DEV__) {
      console.log('[AUTO-DETECT] Auto-interception enabled successfully');
    }
  }

  /**
   * Disable automatic API interception
   */
  disableAutoInterception(): void {
    if (this.apiInterceptor) {
      try {
        this.apiInterceptor.disable();
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to disable fetch interception:', error);
        }
      }
    }
    if (this.axiosInterceptor) {
      try {
        this.axiosInterceptor.disable();
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to disable axios interception:', error);
        }
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disableAutoInterception();
    this.networkMonitor.destroy();
    this.removeAllListeners();
  }
}

// Export singleton instance
let queueManager: QueueManager;
try {
  queueManager = new QueueManager();
} catch (error) {
  if (__DEV__) {
    console.error('Failed to create QueueManager singleton, using stub:', error);
  }
  // Create a stub QueueManager to prevent module export failure
  queueManager = {
    initialize: async () => {},
    push: async () => { throw new Error('QueueManager not initialized'); },
    getPendingRequests: async () => [],
    getFailedRequests: async () => [],
    updateRequestStatus: async () => {},
    triggerSync: async () => {},
    enableAutoInterception: () => {},
    disableAutoInterception: () => {},
    getNetworkMonitor: () => ({
      getStatus: () => 'unknown' as const,
      isOnline: () => false,
      isOffline: () => true,
      destroy: () => {},
    }),
    destroy: () => {},
  } as any;
}
export default queueManager;



