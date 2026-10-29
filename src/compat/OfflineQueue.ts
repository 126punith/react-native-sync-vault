import { SyncVault } from '../core/SyncVault';
import type { ConflictStrategy, EnqueueOptions, SyncRequest, SyncVaultConfig } from '../core/types';
import type { ConflictResolutionStrategy, QueuePushOptions } from '../types';

function toStrategy(strategy: ConflictResolutionStrategy | undefined, hasCustom: boolean): ConflictStrategy {
  switch (strategy) {
    case 'client_wins':
      return 'client_wins';
    case 'server_wins':
      return 'server_wins';
    case 'custom':
      return hasCustom ? 'merge' : 'manual';
    default:
      return 'manual';
  }
}

export function pushOptionsToEnqueue(options: QueuePushOptions): EnqueueOptions {
  return {
    method: options.method,
    url: options.url,
    body: options.data,
    headers: options.headers,
    queryParams: options.queryParams,
    priority: options.priority,
    // v1 counted retries after the first attempt.
    maxAttempts: options.maxRetries != null ? options.maxRetries + 1 : undefined,
    conflictStrategy: toStrategy(options.conflictResolution, !!options.customResolver),
    merge: options.customResolver ? (local, server) => options.customResolver!(local, server) : undefined,
    metadata: options.metadata,
  };
}

/**
 * @deprecated v1 API kept for migration. Use `SyncVault` directly:
 *   OfflineQueue.initialize(config) -> SyncVault.configure(config)
 *   OfflineQueue.push(options)      -> SyncVault.enqueue(options)
 */
export const OfflineQueue = {
  initialize(config: SyncVaultConfig = {}): Promise<void> {
    return SyncVault.configure(config);
  },
  push(options: QueuePushOptions): Promise<string> {
    return SyncVault.enqueue(pushOptionsToEnqueue(options));
  },
  getPendingRequests(limit = 100): Promise<SyncRequest[]> {
    return SyncVault.getPending(limit);
  },
  getFailedRequests(limit = 100): Promise<SyncRequest[]> {
    return SyncVault.getDeadLetters(limit);
  },
  retryRequest(id: string): Promise<void> {
    return SyncVault.retry(id);
  },
  removeRequest(id: string): Promise<void> {
    return SyncVault.discard(id);
  },
  triggerSync(): void {
    SyncVault.drainNow();
  },
};

export default OfflineQueue;
