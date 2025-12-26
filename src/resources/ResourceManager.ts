import BatteryMonitor from './BatteryMonitor';
import NetworkQualityDetector from './NetworkQualityDetector';
import NetworkMonitor from '../NetworkMonitor';

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
    minQualityForLargeUploads?: NetworkQuality; // Minimum quality for large uploads
    maxPayloadSizeOnCellular?: number; // Max payload size on cellular (bytes)
  };
  storage?: {
    maxCacheSize?: number; // Max cache size in bytes
    cleanupOnLowStorage?: boolean; // Cleanup when storage is low
  };
}

export type NetworkQuality = 'unknown' | 'poor' | 'fair' | 'good' | 'excellent';

/**
 * Resource Manager
 * Manages device resources for intelligent sync behavior
 */
class ResourceManager {
  private batteryMonitor: BatteryMonitor;
  private networkQualityDetector: NetworkQualityDetector;
  private networkMonitor: NetworkMonitor;
  private config: ResourceAwareConfig;

  constructor(
    networkMonitor: NetworkMonitor,
    config: ResourceAwareConfig = {}
  ) {
    this.networkMonitor = networkMonitor;
    this.config = config;
    this.batteryMonitor = new BatteryMonitor();
    this.networkQualityDetector = new NetworkQualityDetector(networkMonitor);
  }

  /**
   * Check if sync should proceed based on resources
   */
  shouldSync(isCritical: boolean = false): boolean {
    // Check battery
    const batteryThreshold = this.config.battery?.lowThreshold ?? 20;
    if (this.batteryMonitor.isLow(batteryThreshold)) {
      const action = this.config.battery?.action ?? 'defer_non_critical';
      if (action === 'pause') {
        return false;
      }
      if (action === 'defer_non_critical' && !isCritical) {
        return false;
      }
      if (this.config.battery?.criticalOnly && !isCritical) {
        return false;
      }
    }

    // Check network
    if (!this.networkMonitor.isOnline()) {
      return false;
    }

    return true;
  }

  /**
   * Check if large upload should be deferred
   */
  shouldDeferLargeUpload(sizeBytes: number): boolean {
    if (!this.config.network?.deferLargeUploadsOnCellular) {
      return false;
    }

    const maxSize = this.config.network?.maxPayloadSizeOnCellular ?? 100 * 1024; // 100KB default
    return this.networkQualityDetector.shouldDeferTransfer(sizeBytes, maxSize);
  }

  /**
   * Get sync priority based on resources
   */
  getSyncPriority(isCritical: boolean = false): number {
    let priority = isCritical ? 10 : 5;

    // Reduce priority if battery is low
    const batteryThreshold = this.config.battery?.lowThreshold ?? 20;
    if (this.batteryMonitor.isLow(batteryThreshold)) {
      priority -= 2;
    }

    // Reduce priority if network quality is poor
    const quality = this.networkQualityDetector.getQuality();
    if (quality === 'poor') {
      priority -= 3;
    } else if (quality === 'fair') {
      priority -= 1;
    }

    return Math.max(0, priority);
  }

  /**
   * Get battery level
   */
  getBatteryLevel(): number {
    return this.batteryMonitor.getLevel();
  }

  /**
   * Check if battery is low
   */
  isBatteryLow(): boolean {
    const threshold = this.config.battery?.lowThreshold ?? 20;
    return this.batteryMonitor.isLow(threshold);
  }

  /**
   * Get network quality
   */
  getNetworkQuality(): NetworkQuality {
    return this.networkQualityDetector.getQuality();
  }

  /**
   * Get network type
   */
  getNetworkType(): string {
    return this.networkQualityDetector.getType();
  }

  /**
   * Estimate transfer time for data size
   */
  estimateTransferTime(sizeBytes: number): number {
    return this.networkQualityDetector.estimateTransferTime(sizeBytes);
  }

  /**
   * Refresh resource status
   */
  async refresh(): Promise<void> {
    await Promise.all([
      this.batteryMonitor.refresh(),
      this.networkQualityDetector.refresh(),
    ]);
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.batteryMonitor.destroy();
  }
}

export default ResourceManager;

