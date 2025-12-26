import { getMetricsCollector, SyncEventType } from './MetricsCollector';
import NetworkMonitor from '../NetworkMonitor';

/**
 * Sync Metrics
 * High-level API for sync performance tracking
 */
class SyncMetrics {
  private metricsCollector = getMetricsCollector();
  private queueManager: any = null;
  private networkMonitor: NetworkMonitor | null = null;

  constructor(queueManager?: any, networkMonitor?: NetworkMonitor) {
    this.queueManager = queueManager || null;
    this.networkMonitor = networkMonitor || null;
  }

  /**
   * Record sync event
   */
  recordSyncEvent(
    type: SyncEventType,
    value: number,
    metadata?: Record<string, any>
  ): void {
    this.metricsCollector.recordEvent({ type, value, metadata });
  }

  /**
   * Get current queue size
   */
  async getQueueSize(): Promise<number> {
    if (!this.queueManager) {
      return 0;
    }
    try {
      const pending = await this.queueManager.getPendingRequests(1000, 0);
      return pending.length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get oldest queued item age (in milliseconds)
   */
  async getOldestQueuedItemAge(): Promise<number | null> {
    if (!this.queueManager) {
      return null;
    }
    try {
      const pending = await this.queueManager.getPendingRequests(1, 0);
      if (pending.length === 0) {
        return null;
      }
      const oldest = pending[0];
      return Date.now() - (oldest.createdAt || Date.now());
    } catch (error) {
      return null;
    }
  }

  /**
   * Get network quality
   */
  getNetworkQuality(): string {
    if (!this.networkMonitor) {
      return 'unknown';
    }
    return this.networkMonitor.getStatus();
  }

  /**
   * Get comprehensive metrics
   */
  async getMetrics(): Promise<{
    queueSize: number;
    oldestQueuedItem: string | null; // Human-readable age
    cacheHitRate: number;
    syncSuccessRate: number;
    averageSyncTime: number;
    lastSyncAt: Date | null;
    networkQuality: string;
  }> {
    const queueSize = await this.getQueueSize();
    const oldestAge = await this.getOldestQueuedItemAge();
    const summary = this.metricsCollector.getSummary();

    // Format oldest item age
    let oldestQueuedItem: string | null = null;
    if (oldestAge !== null) {
      const hours = Math.floor(oldestAge / (1000 * 60 * 60));
      const minutes = Math.floor((oldestAge % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 0) {
        oldestQueuedItem = `${hours}h ${minutes}m`;
      } else {
        oldestQueuedItem = `${minutes}m`;
      }
    }

    return {
      queueSize,
      oldestQueuedItem,
      cacheHitRate: summary.cacheHitRate,
      syncSuccessRate: summary.syncSuccessRate,
      averageSyncTime: summary.averageSyncTime,
      lastSyncAt: summary.lastSyncAt ? new Date(summary.lastSyncAt) : null,
      networkQuality: this.getNetworkQuality(),
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metricsCollector.reset();
  }
}

export default SyncMetrics;

