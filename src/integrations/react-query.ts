import { OfflineQueueConfig } from '../types';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

/**
 * React Query Integration
 * Wraps QueryClient with sync vault for offline support
 * 
 * Note: Requires @tanstack/react-query to be installed
 */
export function withSyncVault(
  queryClient: any, // QueryClient from @tanstack/react-query
  config: OfflineQueueConfig
): any {
  // Initialize offline queue
  // Note: This is a simplified integration
  // In a full implementation, you would:
  // 1. Intercept query mutations to queue them
  // 2. Use sync vault cache for query data
  // 3. Sync mutations when online

  // Store config for later use
  (queryClient as any).__syncVaultConfig = config;

  return queryClient;
}

/**
 * Hook to use React Query with sync vault
 */
export function useReactQueryWithSyncVault(config: OfflineQueueConfig) {
  const queue = useOfflineQueue(config);

  // Dynamically import QueryClient if available
  let QueryClient: any = null;
  try {
    QueryClient = require('@tanstack/react-query').QueryClient;
  } catch (error) {
    // React Query not installed
  }

  return {
    queryClient: QueryClient ? new QueryClient() : null,
    queue,
  };
}

