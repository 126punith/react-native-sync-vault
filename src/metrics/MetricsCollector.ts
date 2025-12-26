import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Sync Event Type
 */
export type SyncEventType =
  | 'queue_size'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'cache_hit'
  | 'cache_miss'
  | 'request_queued'
  | 'request_synced';

/**
 * Sync Event
 */
export interface SyncEvent {
  type: SyncEventType;
  value: number;
  metadata?: Record<string, any>;
  timestamp: number;
}

/**
 * Metrics Collector
 * Collects sync performance metrics
 */
class MetricsCollector {
  private events: SyncEvent[] = [];
  private maxEvents: number = 1000; // Keep last 1000 events
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private syncCount: number = 0;
  private syncSuccessCount: number = 0;
  private syncFailureCount: number = 0;
  private totalSyncTime: number = 0;
  private lastSyncAt: number | null = null;

  /**
   * Record a sync event
   */
  recordEvent(event: Omit<SyncEvent, 'timestamp'>): void {
    const fullEvent: SyncEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(fullEvent);

    // Keep only last N events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Update counters
    switch (event.type) {
      case 'cache_hit':
        this.cacheHits++;
        break;
      case 'cache_miss':
        this.cacheMisses++;
        break;
      case 'sync_started':
        this.syncCount++;
        break;
      case 'sync_completed':
        this.syncSuccessCount++;
        if (event.value) {
          this.totalSyncTime += event.value; // value is duration in ms
        }
        this.lastSyncAt = Date.now();
        break;
      case 'sync_failed':
        this.syncFailureCount++;
        break;
    }
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) {
      return 0;
    }
    return this.cacheHits / total;
  }

  /**
   * Get sync success rate
   */
  getSyncSuccessRate(): number {
    if (this.syncCount === 0) {
      return 0;
    }
    return this.syncSuccessCount / this.syncCount;
  }

  /**
   * Get average sync time
   */
  getAverageSyncTime(): number {
    if (this.syncSuccessCount === 0) {
      return 0;
    }
    return this.totalSyncTime / this.syncSuccessCount;
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100): SyncEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: SyncEventType): SyncEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.events = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.syncCount = 0;
    this.syncSuccessCount = 0;
    this.syncFailureCount = 0;
    this.totalSyncTime = 0;
    this.lastSyncAt = null;
  }

  /**
   * Get all metrics summary
   */
  getSummary() {
    return {
      cacheHitRate: this.getCacheHitRate(),
      syncSuccessRate: this.getSyncSuccessRate(),
      averageSyncTime: this.getAverageSyncTime(),
      totalSyncs: this.syncCount,
      successfulSyncs: this.syncSuccessCount,
      failedSyncs: this.syncFailureCount,
      lastSyncAt: this.lastSyncAt,
      totalEvents: this.events.length,
    };
  }
}

// Singleton instance
let metricsCollectorInstance: MetricsCollector | null = null;

/**
 * Get MetricsCollector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
  }
  return metricsCollectorInstance;
}

export default MetricsCollector;

