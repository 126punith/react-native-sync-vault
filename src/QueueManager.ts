import { NativeModules } from 'react-native';
import {
  QueuedRequest,
  QueuePushOptions,
  RequestStatus,
  SyncDataPoint,
  InterceptorConfig,
} from './types';
import { generateRequestId } from './utils/idGenerator';
import { performanceTracker } from './utils/performance';

// Lazy import NetworkMonitor to avoid evaluation errors
let NetworkMonitorClass: any = null;
function getNetworkMonitorClass() {
  if (!NetworkMonitorClass) {
    try {
      console.log('[DEBUG] getNetworkMonitorClass: Attempting to require NetworkMonitor');
      const networkMonitorModule = require('./NetworkMonitor');
      console.log('[DEBUG] getNetworkMonitorClass: Module loaded, has default:', !!networkMonitorModule.default);
      NetworkMonitorClass = networkMonitorModule.default;
      console.log('[DEBUG] getNetworkMonitorClass: NetworkMonitorClass extracted:', !!NetworkMonitorClass);
    } catch (error) {
      console.error('[DEBUG] getNetworkMonitorClass: Error loading NetworkMonitor:', error);
      console.warn('Failed to load NetworkMonitor class:', error);
      return null;
    }
  }
  return NetworkMonitorClass;
}

// Get native module with error handling
let NativeModule: any = null;
let nativeModuleWarningShown = false;
try {
  NativeModule = NativeModules.OfflineQueue;
  if (!NativeModule && !nativeModuleWarningShown) {
    console.warn('OfflineQueue native module not found. Some features may not work.');
    nativeModuleWarningShown = true;
  }
} catch (error) {
  if (!nativeModuleWarningShown) {
    console.warn('Failed to access native module:', error);
    nativeModuleWarningShown = true;
  }
}

/**
 * Queue Manager - Main class for managing offline request queue
 */
class QueueManager {
  private networkMonitor: any;
  private isInitialized: boolean = false;
  private apiInterceptor: any = null;

  constructor() {
    try {
      console.log('[DEBUG] QueueManager constructor: Attempting to load NetworkMonitor');
      const NetworkMonitorClass = getNetworkMonitorClass();
      console.log('[DEBUG] QueueManager constructor: NetworkMonitorClass loaded:', !!NetworkMonitorClass);
      if (NetworkMonitorClass) {
        console.log('[DEBUG] QueueManager constructor: Creating NetworkMonitor instance');
        this.networkMonitor = new NetworkMonitorClass();
        console.log('[DEBUG] QueueManager constructor: NetworkMonitor created successfully, status:', this.networkMonitor.getStatus());
      } else {
        throw new Error('NetworkMonitor class not available');
      }
    } catch (error) {
      console.error('[DEBUG] QueueManager constructor: Failed to create NetworkMonitor:', error);
      console.warn('Failed to create NetworkMonitor, using stub with native fallback:', error);
      // Create a stub NetworkMonitor that checks native module directly
      let stubStatus: 'online' | 'offline' | 'unknown' = 'unknown';
      this.networkMonitor = {
        _lastStatus: 'unknown',
        getStatus: () => stubStatus,
        isOnline: () => {
          // Stub returns false - will be updated by refreshStatus if native module works
          return false;
        },
        isOffline: () => {
          // Stub returns true - will be updated by refreshStatus if native module works
          return true;
        },
        refreshStatus: async () => {
          try {
            if (NativeModule) {
              // Try calling getNetworkStatus even if it's not enumerable
              // React Native methods might exist but not be enumerable
              try {
                const status = await NativeModule.getNetworkStatus();
                console.log('[DEBUG] Stub NetworkMonitor.refreshStatus() got status from native:', status);
                // Update the stub's status
                if (status === 'online') {
                  stubStatus = 'online';
                } else if (status === 'offline') {
                  stubStatus = 'offline';
                } else {
                  stubStatus = 'unknown';
                }
                this.networkMonitor._lastStatus = stubStatus;
                console.log('[DEBUG] Stub NetworkMonitor.refreshStatus() updated stubStatus to:', stubStatus);
                return;
              } catch (e) {
                // Method might not exist, but try anyway
                console.warn('[DEBUG] Stub NetworkMonitor.refreshStatus() getNetworkStatus call failed:', e);
              }
            }
          } catch (e) {
            console.warn('[DEBUG] Stub NetworkMonitor.refreshStatus() error:', e);
          }
        },
        destroy: () => {},
        on: () => this.networkMonitor,
        off: () => this.networkMonitor,
        emit: () => false,
        removeAllListeners: () => this.networkMonitor,
        listenerCount: () => 0,
      } as any;
      console.log('[DEBUG] QueueManager constructor: Using stub NetworkMonitor with native fallback');
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
        console.warn('Failed to get sync status during initialization:', error);
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
          console.warn('Failed to insert data point:', error);
        }
      }

      // Update sync status
      await this.updateSyncStatusCounters();

      // If online, trigger immediate sync attempt (non-blocking)
      // Try to refresh status first if it's unknown and refreshStatus is available
      if (this.networkMonitor.getStatus() === 'unknown' && typeof this.networkMonitor.refreshStatus === 'function') {
        this.networkMonitor.refreshStatus().then(() => {
          const isOnline = this.networkMonitor.isOnline();
          if (isOnline) {
            console.log('[DEBUG] QueueManager.push() network is online (after refresh), triggering sync');
            this.triggerSync().catch((error) => {
              console.warn('Failed to trigger immediate sync:', error);
            });
          } else {
            console.log('[DEBUG] QueueManager.push() network is offline (after refresh), not triggering sync');
          }
        }).catch((error: any) => {
          console.warn('[DEBUG] QueueManager.push() error refreshing network status:', error);
          // Fall back to checking current status
          if (this.networkMonitor.isOnline()) {
            this.triggerSync().catch((err) => console.warn('Failed to trigger sync:', err));
          }
        });
      } else {
        const isOnline = this.networkMonitor.isOnline();
        if (isOnline) {
          console.log('[DEBUG] QueueManager.push() network is online, triggering sync');
          this.triggerSync().catch((error) => {
            console.warn('Failed to trigger immediate sync:', error);
          });
        } else {
          console.log('[DEBUG] QueueManager.push() network is offline, not triggering sync');
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

      await NativeModule.updateSyncStatus({
        totalPending: pending.length,
        totalFailed: failed.length,
        networkStatus: this.networkMonitor.getStatus(),
      });
    } catch (error) {
      console.warn('Failed to update sync status counters:', error);
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
    if (!config.enabled) {
      return;
    }

    try {
      if (!this.apiInterceptor) {
        const ApiInterceptorClass = require('./ApiInterceptor').default;
        this.apiInterceptor = new ApiInterceptorClass();
      }
      this.apiInterceptor.enable(config, this);
    } catch (error) {
      console.error('Failed to enable auto interception:', error);
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
        console.error('Failed to disable auto interception:', error);
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disableAutoInterception();
    this.networkMonitor.destroy();
  }
}

// Export singleton instance
let queueManager: QueueManager;
try {
  queueManager = new QueueManager();
} catch (error) {
  console.error('Failed to create QueueManager singleton, using stub:', error);
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



