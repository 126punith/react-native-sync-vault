import { useEffect, useState } from 'react';
import { getSyncMetrics, type SyncMetricsSnapshot } from '../metrics/SyncMetrics';
import { useSyncStatus } from './useSyncStatus';

export interface SyncMetricsResult extends SyncMetricsSnapshot {
  queueSize: number;
  deadLetterCount: number;
  conflictCount: number;
}

/** Session delivery metrics plus live queue counts. */
export function useSyncMetrics(): SyncMetricsResult {
  const metrics = getSyncMetrics();
  const [snapshot, setSnapshot] = useState<SyncMetricsSnapshot>(() => metrics.getSnapshot());
  const status = useSyncStatus();

  useEffect(() => metrics.subscribe(setSnapshot), [metrics]);

  return {
    ...snapshot,
    queueSize: status.pendingCount,
    deadLetterCount: status.counts.deadLetter,
    conflictCount: status.counts.conflict,
  };
}
