import { NativeEventEmitter, Platform } from 'react-native';
import { NetworkStatus } from './types';
import { EventEmitter } from './utils/EventEmitter';
import { getNativeModule } from './utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();
let NativeEventEmitterInstance: NativeEventEmitter | null = null;
if (NativeModule) {
  try {
    NativeEventEmitterInstance = new NativeEventEmitter(NativeModule);
  } catch (error) {
    if (__DEV__) {
      console.warn('Failed to create NativeEventEmitter:', error);
    }
  }
}

/**
 * Network status monitor
 * Monitors network connectivity using native module and emits events when status changes
 */
class NetworkMonitor extends EventEmitter {
  private currentStatus: NetworkStatus = 'unknown';
  private eventSubscription: any = null;

  constructor() {
    super();
    if (__DEV__) {
      console.log('[AUTO-DETECT] NetworkMonitor initialized');
    }
    try {
      // Initialize asynchronously to avoid blocking module load
      this.initialize().catch((error) => {
        if (__DEV__) {
          console.warn('NetworkMonitor initialization failed:', error);
        }
        // Set default status if initialization fails
        this.currentStatus = 'unknown';
      });
    } catch (error) {
      if (__DEV__) {
        console.error('NetworkMonitor constructor error:', error);
      }
      throw error;
    }
  }

  /**
   * Initialize network monitoring
   */
  private async initialize(): Promise<void> {
    try {
      // Check if native module is available
      let canCallGetNetworkStatus = false;
      if (NativeModule) {
        try {
          const testCall = NativeModule.getNetworkStatus;
          canCallGetNetworkStatus = typeof testCall === 'function';
          if (!canCallGetNetworkStatus) {
            // Try calling it directly - sometimes methods exist but aren't enumerable
            try {
              const testResult = await NativeModule.getNetworkStatus();
              canCallGetNetworkStatus = true;
              // If direct call works, use it
              this.currentStatus = this.mapNativeStatus(testResult);
              return;
            } catch (e) {
              // Method doesn't exist
            }
          }
        } catch (e) {
          // Error checking
        }
      }
      
      if (!NativeModule || !canCallGetNetworkStatus) {
        if (__DEV__) {
          console.warn('Native network module is not available. Network monitoring will be disabled.');
        }
        this.currentStatus = 'unknown';
        return;
      }

      // Check permission status (if available)
      if (NativeModule && typeof NativeModule.hasNetworkPermission === 'function') {
        try {
          const hasPermission = await NativeModule.hasNetworkPermission();
          if (!hasPermission) {
            if (__DEV__) {
              console.warn('ACCESS_NETWORK_STATE permission not granted. Network status will be "unknown".');
            }
            this.currentStatus = 'unknown';
            return;
          }
        } catch (e) {
          // Continue anyway - permission check might not be available on all platforms
        }
      }

      // Get initial status
      const status = await NativeModule.getNetworkStatus();
      this.currentStatus = this.mapNativeStatus(status);
      
      if (__DEV__) {
        console.log('[AUTO-DETECT] Initial network status:', { status: this.currentStatus });
      }

      // Subscribe to network state changes from native module
      if (NativeEventEmitterInstance) {
        this.eventSubscription = NativeEventEmitterInstance.addListener(
          'networkStatusChanged',
          (event: { status: string; previousStatus: string }) => {
            const newStatus = this.mapNativeStatus(event.status);
            if (newStatus !== this.currentStatus) {
              const previousStatus = this.currentStatus;
              this.currentStatus = newStatus;
              
              if (__DEV__) {
                console.log('[AUTO-DETECT] Network status changed:', { 
                  previous: previousStatus, 
                  current: newStatus 
                });
              }
              
              this.emit('statusChange', { previous: previousStatus, current: newStatus });
              
              if (newStatus === 'online') {
                this.emit('online');
              } else if (newStatus === 'offline') {
                this.emit('offline');
              }
            }
          }
        );
        
        if (__DEV__) {
          console.log('[AUTO-DETECT] Subscribed to native network status events');
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to initialize NetworkMonitor:', error);
      }
      this.currentStatus = 'unknown';
      // Don't throw - allow module to continue loading
    }
  }

  /**
   * Map native status string to our NetworkStatus type
   */
  private mapNativeStatus(status: string): NetworkStatus {
    if (status === 'online' || status === 'offline') {
      return status as NetworkStatus;
    }
    return 'unknown';
  }

  /**
   * Get current network status
   * If native module is available but getNetworkStatus wasn't exposed, try calling it directly
   */
  getStatus(): NetworkStatus {
    // If status is unknown and native module exists, try to get it directly
    if (this.currentStatus === 'unknown' && NativeModule) {
      // Try synchronous check first (won't work if method doesn't exist, but worth trying)
      if (typeof NativeModule.getNetworkStatus === 'function') {
        // Method exists, but we're in sync context - can't await
        // Return unknown for now, async initialization will update it
        return 'unknown';
      }
    }
    return this.currentStatus;
  }

  /**
   * Check if currently online
   */
  isOnline(): boolean {
    return this.currentStatus === 'online';
  }

  /**
   * Check if currently offline
   */
  isOffline(): boolean {
    return this.currentStatus === 'offline';
  }
  
  /**
   * Refresh network status from native module (async)
   */
  async refreshStatus(): Promise<void> {
    if (__DEV__) {
      console.log('[AUTO-DETECT] Refreshing network status...');
    }
    if (NativeModule && this.currentStatus === 'unknown') {
      try {
        const status = await NativeModule.getNetworkStatus();
        const mappedStatus = this.mapNativeStatus(status);
        if (mappedStatus !== 'unknown') {
          this.currentStatus = mappedStatus;
          if (__DEV__) {
            console.log('[AUTO-DETECT] Network status refreshed:', { status: mappedStatus });
          }
        }
      } catch (e) {
        if (__DEV__) {
          console.warn('[AUTO-DETECT] Failed to refresh network status:', e);
        }
      }
    }
  }

  /**
   * Cleanup - unsubscribe from network events
   */
  destroy(): void {
    if (this.eventSubscription) {
      this.eventSubscription.remove();
      this.eventSubscription = null;
    }
    this.removeAllListeners();
  }
}

export default NetworkMonitor;

