import NetworkMonitor from '../NetworkMonitor';
import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Network Quality Types
 */
export type NetworkQuality = 'unknown' | 'poor' | 'fair' | 'good' | 'excellent';
export type NetworkType = 'wifi' | 'cellular' | 'ethernet' | 'unknown';

/**
 * Network Quality Detector
 * Detects network quality and type for resource-aware sync
 */
class NetworkQualityDetector {
  private networkMonitor: NetworkMonitor;
  private currentQuality: NetworkQuality = 'unknown';
  private currentType: NetworkType = 'unknown';
  private lastBandwidthTest: number = 0;
  private bandwidthEstimate: number = 0; // bytes per second

  constructor(networkMonitor: NetworkMonitor) {
    this.networkMonitor = networkMonitor;
    this.initialize();
  }

  /**
   * Initialize network quality detection
   */
  private async initialize(): Promise<void> {
    try {
      await this.detectNetworkType();
      await this.estimateBandwidth();
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to initialize network quality detection:', error);
      }
    }
  }

  /**
   * Detect network type (WiFi, Cellular, etc.)
   */
  private async detectNetworkType(): Promise<void> {
    try {
      if (NativeModule && NativeModule.getNetworkType) {
        const type = await NativeModule.getNetworkType();
        if (type) {
          this.currentType = this.normalizeNetworkType(type);
        }
      } else {
        // Fallback: infer from network status
        const status = this.networkMonitor.getStatus();
        if (status === 'online') {
          // Default to unknown if we can't detect
          this.currentType = 'unknown';
        } else {
          this.currentType = 'unknown';
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to detect network type:', error);
      }
    }
  }

  /**
   * Normalize network type string
   */
  private normalizeNetworkType(type: string): NetworkType {
    const lower = type.toLowerCase();
    if (lower.includes('wifi') || lower.includes('wlan')) {
      return 'wifi';
    }
    if (lower.includes('cellular') || lower.includes('mobile') || lower.includes('wwan')) {
      return 'cellular';
    }
    if (lower.includes('ethernet') || lower.includes('lan')) {
      return 'ethernet';
    }
    return 'unknown';
  }

  /**
   * Estimate network bandwidth
   */
  private async estimateBandwidth(): Promise<void> {
    try {
      if (NativeModule && NativeModule.getNetworkBandwidth) {
        const bandwidth = await NativeModule.getNetworkBandwidth();
        if (bandwidth) {
          this.bandwidthEstimate = bandwidth;
          this.lastBandwidthTest = Date.now();
        }
      } else {
        // Fallback: estimate based on network type
        this.bandwidthEstimate = this.estimateBandwidthByType();
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to estimate bandwidth:', error);
      }
      this.bandwidthEstimate = this.estimateBandwidthByType();
    }
  }

  /**
   * Estimate bandwidth based on network type
   */
  private estimateBandwidthByType(): number {
    switch (this.currentType) {
      case 'wifi':
        return 5 * 1024 * 1024; // 5 MB/s conservative estimate
      case 'ethernet':
        return 10 * 1024 * 1024; // 10 MB/s
      case 'cellular':
        return 500 * 1024; // 500 KB/s conservative estimate
      default:
        return 100 * 1024; // 100 KB/s very conservative
    }
  }

  /**
   * Get current network quality
   */
  getQuality(): NetworkQuality {
    return this.currentQuality;
  }

  /**
   * Get current network type
   */
  getType(): NetworkType {
    return this.currentType;
  }

  /**
   * Get bandwidth estimate (bytes per second)
   */
  getBandwidthEstimate(): number {
    return this.bandwidthEstimate;
  }

  /**
   * Check if network is suitable for large uploads
   */
  isSuitableForLargeUploads(minQuality: NetworkQuality = 'good'): boolean {
    const qualityOrder: NetworkQuality[] = ['unknown', 'poor', 'fair', 'good', 'excellent'];
    const currentIndex = qualityOrder.indexOf(this.currentQuality);
    const minIndex = qualityOrder.indexOf(minQuality);

    // WiFi and Ethernet are always suitable
    if (this.currentType === 'wifi' || this.currentType === 'ethernet') {
      return true;
    }

    return currentIndex >= minIndex;
  }

  /**
   * Estimate time to transfer data (seconds)
   */
  estimateTransferTime(sizeBytes: number): number {
    if (this.bandwidthEstimate === 0) {
      return Infinity; // Unknown bandwidth
    }
    return sizeBytes / this.bandwidthEstimate;
  }

  /**
   * Check if transfer should be deferred based on size and network
   */
  shouldDeferTransfer(sizeBytes: number, maxSizeOnCellular?: number): boolean {
    // If on cellular and size exceeds threshold, defer
    if (this.currentType === 'cellular' && maxSizeOnCellular) {
      return sizeBytes > maxSizeOnCellular;
    }

    // If quality is poor, defer large transfers
    if (this.currentQuality === 'poor' && sizeBytes > 100 * 1024) {
      return true;
    }

    return false;
  }

  /**
   * Refresh network quality
   */
  async refresh(): Promise<void> {
    await this.detectNetworkType();
    await this.estimateBandwidth();
    this.updateQuality();
  }

  /**
   * Update quality based on bandwidth and type
   */
  private updateQuality(): void {
    if (this.currentType === 'wifi' || this.currentType === 'ethernet') {
      this.currentQuality = 'excellent';
    } else if (this.currentType === 'cellular') {
      // Estimate quality based on bandwidth
      if (this.bandwidthEstimate > 2 * 1024 * 1024) {
        // > 2 MB/s
        this.currentQuality = 'good';
      } else if (this.bandwidthEstimate > 500 * 1024) {
        // > 500 KB/s
        this.currentQuality = 'fair';
      } else {
        // < 500 KB/s
        this.currentQuality = 'poor';
      }
    } else {
      this.currentQuality = 'unknown';
    }
  }
}

export default NetworkQualityDetector;

