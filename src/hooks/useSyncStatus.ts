import { useCallback, useSyncExternalStore } from 'react';
import { SyncVault } from '../core/SyncVault';
import type { NetworkState } from '../core/types';
import { statusStore, type VaultStatus } from './statusStore';

export interface SyncStatusResult extends VaultStatus {
  isOnline: boolean;
  /** pending + inflight */
  pendingCount: number;
  drainNow: () => void;
  retryAllDeadLetters: () => Promise<number>;
}

/** Queue counts, connectivity, and drain activity. Subscribes to engine events; never polls. */
export function useSyncStatus(): SyncStatusResult {
  const status = useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot);
  const drainNow = useCallback(() => SyncVault.drainNow(), []);
  const retryAllDeadLetters = useCallback(() => SyncVault.retryAllDeadLetters(), []);
  return {
    ...status,
    isOnline: status.network.isConnected,
    pendingCount: status.counts.pending + status.counts.inflight,
    drainNow,
    retryAllDeadLetters,
  };
}

/** @deprecated Alias of useSyncStatus. */
export const useQueueStatus = useSyncStatus;

export function useNetworkState(): NetworkState {
  return useSyncExternalStore(
    statusStore.subscribe,
    () => statusStore.getSnapshot().network,
    () => statusStore.getSnapshot().network
  );
}
