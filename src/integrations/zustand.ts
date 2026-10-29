import { SyncVault } from '../core/SyncVault';
import type { EnqueueOptions, QueueCounts } from '../core/types';

export interface SyncVaultSlice {
  syncVault: {
    enqueue: (options: EnqueueOptions) => Promise<string>;
    drainNow: () => void;
    getCounts: () => Promise<QueueCounts>;
  };
}

/**
 * Adds a `syncVault` slice to a Zustand store creator so actions can queue requests:
 *
 *   create(withSyncVault((set, get) => ({ addTodo: async (t) => { set(...); await get().syncVault.enqueue({...}) } })))
 */
export function withSyncVault<T extends object, S = unknown, G = unknown>(storeCreator: (set: S, get: G) => T) {
  return (set: S, get: G): T & SyncVaultSlice => ({
    ...storeCreator(set, get),
    syncVault: {
      enqueue: (options) => SyncVault.enqueue(options),
      drainNow: () => SyncVault.drainNow(),
      getCounts: () => SyncVault.getCounts(),
    },
  });
}
