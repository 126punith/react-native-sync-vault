import { useState, useEffect, useCallback } from 'react';
import SyncMetrics from '../metrics/SyncMetrics';
import QueueManager from '../QueueManager';
import NetworkMonitor from '../NetworkMonitor';

/**
 * Sync Metrics Result
 */
export interface SyncMetricsResult {
  queueSize: number;
  oldestQueuedItem: string | null;
  cacheHitRate: number;
  syncSuccessRate: number;
  averageSyncTime: number;
  lastSyncAt: Date | null;
  networkQuality: string;
}

/**
 * Hook for sync metrics
 * Uses event listeners instead of polling for reactive updates
 */
export function useSyncMetrics(): {
  metrics: SyncMetricsResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  recordSyncEvent: (
    type: string,
    value: number,
    metadata?: Record<string, any>
  ) => void;
} {
  const [syncMetrics] = useState(() => {
    // Try to get QueueManager and NetworkMonitor instances
    // This is a simplified version - in production, these should be passed as props
    return new SyncMetrics();
  });

  const [metrics, setMetrics] = useState<SyncMetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const result = await syncMetrics.getMetrics();
      setMetrics(result);
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [syncMetrics]);

  useEffect(() => {
    // Initial fetch
    fetchMetrics();

    // Listen to sync events
    const handleSyncEvent = () => {
      fetchMetrics();
    };

    // Subscribe to events
    if (QueueManager && typeof QueueManager.on === 'function') {
      QueueManager.on('sync:started', handleSyncEvent);
      QueueManager.on('sync:completed', handleSyncEvent);
      QueueManager.on('sync:batch:completed', handleSyncEvent);
      QueueManager.on('sync:failed', handleSyncEvent);
      
      return () => {
        QueueManager.off('sync:started', handleSyncEvent);
        QueueManager.off('sync:completed', handleSyncEvent);
        QueueManager.off('sync:batch:completed', handleSyncEvent);
        QueueManager.off('sync:failed', handleSyncEvent);
      };
    }
  }, [fetchMetrics]);

  const recordSyncEvent = useCallback(
    (
      type: string,
      value: number,
      metadata?: Record<string, any>
    ): void => {
      syncMetrics.recordSyncEvent(
        type as any,
        value,
        metadata
      );
      // Refresh metrics after recording
      fetchMetrics();
    },
    [syncMetrics, fetchMetrics]
  );

  return {
    metrics,
    loading,
    error,
    refetch: fetchMetrics,
    recordSyncEvent,
  };
}

