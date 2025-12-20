import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { NetworkStatus } from './types';
import { EventEmitter } from './utils/EventEmitter';

// Get native module with error handling
let NativeModule: any = null;
let NativeEventEmitterInstance: NativeEventEmitter | null = null;
try {
  NativeModule = NativeModules.OfflineQueue;
  if (NativeModule) {
    NativeEventEmitterInstance = new NativeEventEmitter(NativeModule);
  }
} catch (error) {
  console.warn('Failed to access native module in NetworkMonitor:', error);
}

/**
 * Network status monitor
 * Monitors network connectivity using native module and emits events when status changes
 */
class NetworkMonitor extends EventEmitter {
  private currentStatus: NetworkStatus = 'unknown';
  private eventSubscription: any = null;

  constructor() {
    try {
      super();
      console.log('[DEBUG] NetworkMonitor constructor entry, hasNativeModule:', !!NativeModule);
      // Initialize asynchronously to avoid blocking module load
      this.initialize().catch((error) => {
        console.error('[DEBUG] NetworkMonitor initialization failed:', error);
        console.warn('NetworkMonitor initialization failed:', error);
        // Set default status if initialization fails
        this.currentStatus = 'unknown';
      });
    } catch (error) {
      console.error('[DEBUG] NetworkMonitor constructor error:', error);
      console.error('NetworkMonitor constructor error:', error);
      throw error;
    }
  }

  /**
   * Initialize network monitoring
   */
  private async initialize(): Promise<void> {
    try {
      const hasGetNetworkStatus = !!(NativeModule && typeof NativeModule.getNetworkStatus === 'function');
      const availableMethods = NativeModule ? Object.keys(NativeModule).filter(k => typeof NativeModule[k] === 'function') : [];
      const allKeys = NativeModule ? Object.keys(NativeModule) : [];
      const nativeModuleType = NativeModule ? typeof NativeModule : 'null';
      console.log('[DEBUG] NetworkMonitor.initialize() entry, hasNativeModule:', !!NativeModule, 'hasGetNetworkStatus:', hasGetNetworkStatus, 'availableMethods:', availableMethods, 'allKeys:', allKeys, 'nativeModuleType:', nativeModuleType);
      // Try to call getNetworkStatus directly even if it's not enumerable
      if (NativeModule && !hasGetNetworkStatus) {
        try {
          const testResult = await NativeModule.getNetworkStatus();
          console.log('[DEBUG] getNetworkStatus() call succeeded despite not being enumerable! Result:', testResult);
          // If it works, continue with initialization
        } catch (e) {
          console.log('[DEBUG] getNetworkStatus() call failed:', e);
        }
      }
      // Check if native module is available
      // Try calling getNetworkStatus even if it's not enumerable (React Native methods might not be)
      let canCallGetNetworkStatus = false;
      if (NativeModule) {
        try {
          // Try to call it - React Native methods might exist but not be enumerable
          const testCall = NativeModule.getNetworkStatus;
          canCallGetNetworkStatus = typeof testCall === 'function';
          if (!canCallGetNetworkStatus) {
            // Try calling it directly as a last resort - sometimes methods exist but aren't enumerable
            console.log('[DEBUG] getNetworkStatus not found as property, trying direct call...');
            try {
              const testResult = await NativeModule.getNetworkStatus();
              console.log('[DEBUG] Direct call to getNetworkStatus() succeeded! Result:', testResult);
              canCallGetNetworkStatus = true;
              // If direct call works, use it
              this.currentStatus = this.mapNativeStatus(testResult);
              console.log('[DEBUG] NetworkMonitor initialized with status:', this.currentStatus);
              return;
            } catch (e) {
              console.log('[DEBUG] Direct call to getNetworkStatus() failed:', e);
            }
          }
        } catch (e) {
          console.warn('[DEBUG] Error checking getNetworkStatus:', e);
        }
      }
      
      if (!NativeModule || !canCallGetNetworkStatus) {
        console.warn('[DEBUG] Native network module not available, hasNativeModule:', !!NativeModule, 'getNetworkStatus type:', NativeModule ? typeof NativeModule.getNetworkStatus : 'N/A', 'canCallGetNetworkStatus:', canCallGetNetworkStatus);
        console.warn('Native network module is not available. Network monitoring will be disabled.');
        console.warn('IMPORTANT: The getNetworkStatus method is not exposed. You MUST rebuild the app:');
        console.warn('  cd /Users/punithmanthri/Downloads/OfflineDemoApp/android && ./gradlew clean && cd .. && npx react-native run-android');
        this.currentStatus = 'unknown';
        return;
      }

      // Check permission status (if available)
      if (NativeModule && typeof NativeModule.hasNetworkPermission === 'function') {
        try {
          const hasPermission = await NativeModule.hasNetworkPermission();
          if (!hasPermission) {
            console.warn('ACCESS_NETWORK_STATE permission not granted. Network status will be "unknown".');
            console.warn('Please add <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" /> to AndroidManifest.xml');
            this.currentStatus = 'unknown';
            return;
          }
        } catch (e) {
          console.warn('Error checking network permission:', e);
          // Continue anyway - permission check might not be available on all platforms
        }
      }

      // Get initial status
      console.log('[DEBUG] Calling NativeModule.getNetworkStatus()');
      const status = await NativeModule.getNetworkStatus();
      console.log('[DEBUG] getNetworkStatus() returned:', status, 'mapped to:', this.mapNativeStatus(status));
      this.currentStatus = this.mapNativeStatus(status);

      // Subscribe to network state changes from native module
      if (NativeEventEmitterInstance) {
        this.eventSubscription = NativeEventEmitterInstance.addListener(
          'networkStatusChanged',
          (event: { status: string; previousStatus: string }) => {
            const newStatus = this.mapNativeStatus(event.status);
            if (newStatus !== this.currentStatus) {
              const previousStatus = this.currentStatus;
              this.currentStatus = newStatus;
              this.emit('statusChange', { previous: previousStatus, current: newStatus });
              
              if (newStatus === 'online') {
                this.emit('online');
              } else if (newStatus === 'offline') {
                this.emit('offline');
              }
            }
          }
        );
      }
    } catch (error) {
      console.warn('Failed to initialize NetworkMonitor:', error);
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
    if (NativeModule && this.currentStatus === 'unknown') {
      try {
        // Try calling getNetworkStatus even if it's not enumerable
        const status = await NativeModule.getNetworkStatus();
        const mappedStatus = this.mapNativeStatus(status);
        if (mappedStatus !== 'unknown') {
          this.currentStatus = mappedStatus;
          console.log('[DEBUG] NetworkMonitor.refreshStatus() updated status to:', this.currentStatus);
        }
      } catch (e) {
        console.warn('[DEBUG] refreshStatus() error:', e);
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

