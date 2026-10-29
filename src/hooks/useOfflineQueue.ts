import { useCallback } from 'react';
import { OfflineQueue } from '../compat/OfflineQueue';
import type { QueuePushOptions } from '../types';
import { useSyncStatus } from './useSyncStatus';

/**
 * @deprecated v1 hook kept for migration. Configure once with SyncVault.configure() and use
 * useOfflineMutation / useSyncStatus instead. This hook no longer owns or starts an engine.
 */
export function useOfflineQueue() {
  const status = useSyncStatus();
  const push = useCallback((options: QueuePushOptions) => OfflineQueue.push(options), []);
  return {
    push,
    isOnline: status.isOnline,
    pendingCount: status.pendingCount,
    counts: status.counts,
    triggerSync: status.drainNow,
    getPendingRequests: OfflineQueue.getPendingRequests,
    getFailedRequests: OfflineQueue.getFailedRequests,
    retryRequest: OfflineQueue.retryRequest,
    removeRequest: OfflineQueue.removeRequest,
  };
}
