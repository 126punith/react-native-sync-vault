import { OfflineQueueConfig } from '../types';

// Types for Redux (optional dependency)
type Middleware = any;

/**
 * Redux Middleware for Sync Vault
 * Queues actions that trigger API calls when offline
 */
export function createSyncVaultMiddleware(
  config: OfflineQueueConfig
): Middleware {
  // Dynamically import QueueManager
  const QueueManagerClass = require('../QueueManager').default;
  const queueManager = new QueueManagerClass();

  return (store: any) => (next: any) => (action: any) => {
    // Check if action should be queued
    // This is a simplified version - in production, you would:
    // 1. Check action metadata for API call info
    // 2. Queue the API call if offline
    // 3. Dispatch success/failure actions when synced

    const result = next(action);

    // If action has API call metadata, queue it
    if (action.meta?.apiCall && action.meta?.queueIfOffline) {
      const { method, url, data } = action.meta.apiCall;

      queueManager
        .push({
          method,
          url,
          data,
        })
        .catch((err: any) => {
          if (__DEV__) {
            console.error('Failed to queue action:', err);
          }
        });
    }

    return result;
  };
}

/**
 * Redux Integration Helper
 * Sets up Redux with sync vault middleware
 */
export function withSyncVault(
  reducer: any,
  config: OfflineQueueConfig
): {
  reducer: any;
  middleware: Middleware[];
} {
  return {
    reducer,
    middleware: [createSyncVaultMiddleware(config)],
  };
}

