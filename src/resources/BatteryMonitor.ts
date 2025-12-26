import { NativeEventEmitter } from 'react-native';
import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();
let NativeEventEmitterInstance: NativeEventEmitter | null = null;

if (NativeModule) {
  try {
    NativeEventEmitterInstance = new NativeEventEmitter(NativeModule);
  } catch (error) {
    if (__DEV__) {
      console.warn('Failed to create NativeEventEmitter in BatteryMonitor:', error);
    }
  }
}

/**
 * Battery Monitor
 * Monitors device battery level for resource-aware sync
 */
class BatteryMonitor {
  private currentLevel: number = 100;
  private isCharging: boolean = false;
  private listeners: Map<string, (level: number) => void> = new Map();
  private eventSubscription: any = null;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize battery monitoring
   */
  private async initialize(): Promise<void> {
    try {
      if (NativeModule && NativeModule.getBatteryLevel) {
        const level = await NativeModule.getBatteryLevel();
        this.currentLevel = level || 100;
      }

      if (NativeModule && NativeModule.isBatteryCharging) {
        const charging = await NativeModule.isBatteryCharging();
        this.isCharging = charging || false;
      }

      // Listen for battery level changes
      if (NativeEventEmitterInstance) {
        this.eventSubscription = NativeEventEmitterInstance.addListener(
          'BatteryLevelChanged',
          (data: { level: number; isCharging: boolean }) => {
            this.currentLevel = data.level || this.currentLevel;
            this.isCharging = data.isCharging !== undefined ? data.isCharging : this.isCharging;
            this.notifyListeners();
          }
        );
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to initialize battery monitoring:', error);
      }
    }
  }

  /**
   * Get current battery level (0-100)
   */
  getLevel(): number {
    return this.currentLevel;
  }

  /**
   * Check if device is charging
   */
  isChargingDevice(): boolean {
    return this.isCharging;
  }

  /**
   * Check if battery is low (below threshold)
   */
  isLow(threshold: number = 20): boolean {
    return this.currentLevel < threshold && !this.isCharging;
  }

  /**
   * Check if battery is critical (below 10%)
   */
  isCritical(): boolean {
    return this.currentLevel < 10 && !this.isCharging;
  }

  /**
   * Add battery level change listener
   */
  onLevelChange(listener: (level: number) => void): () => void {
    const id = `listener_${Date.now()}_${Math.random()}`;
    this.listeners.set(id, listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(id);
    };
  }

  /**
   * Notify all listeners of battery level change
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentLevel);
      } catch (error) {
        if (__DEV__) {
          console.error('Error in battery level listener:', error);
        }
      }
    });
  }

  /**
   * Refresh battery level (manual update)
   */
  async refresh(): Promise<void> {
    try {
      if (NativeModule && NativeModule.getBatteryLevel) {
        const level = await NativeModule.getBatteryLevel();
        if (level !== undefined) {
          this.currentLevel = level;
        }
      }

      if (NativeModule && NativeModule.isBatteryCharging) {
        const charging = await NativeModule.isBatteryCharging();
        if (charging !== undefined) {
          this.isCharging = charging;
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to refresh battery level:', error);
      }
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.eventSubscription) {
      this.eventSubscription.remove();
      this.eventSubscription = null;
    }
    this.listeners.clear();
  }
}

export default BatteryMonitor;

