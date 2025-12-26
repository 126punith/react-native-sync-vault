import { OfflineQueueConfig } from '../types';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// Types for Zustand (optional dependency)
type StoreApi<T> = any;
type UseBoundStore<T> = any;

/**
 * Zustand Integration
 * Wraps Zustand store with sync vault for offline support
 */
export function withSyncVault<T extends object>(
  storeCreator: (set: any, get: any) => T,
  config: OfflineQueueConfig
): (set: any, get: any) => T {
  // Initialize offline queue
  const queue = useOfflineQueue(config);

  // Wrap store creator to add sync vault functionality
  return (set: any, get: any) => {
    const store = storeCreator(set, get);

    // Add sync vault methods to store
    return {
      ...store,
      __syncVault: {
        queue,
        sync: async () => {
          // Trigger sync
          await queue.sync();
        },
        getPendingCount: async () => {
          const pending = await queue.getPendingRequests(1000, 0);
          return pending.length;
        },
      },
    };
  };
}

/**
 * Hook to use Zustand with sync vault
 */
export function useZustandWithSyncVault<T extends object>(
  store: UseBoundStore<StoreApi<T>>,
  config: OfflineQueueConfig
) {
  const queue = useOfflineQueue(config);
  const storeState = store();

  return {
    ...storeState,
    syncVault: {
      queue,
      sync: queue.sync,
      getPendingCount: async () => {
        const pending = await queue.getPendingRequests(1000, 0);
        return pending.length;
      },
    },
  };
}

