/**
 * react-native-sync-vault v2: a durable native outbox for React Native (New Architecture).
 *
 *   import { SyncVault } from 'react-native-sync-vault';
 *   await SyncVault.configure({ baseUrl, getAuthHeaders });
 *   await SyncVault.enqueue({ method: 'POST', url: '/todos', body: todo, queueKey: `todo:${todo.id}` });
 */

import ApiInterceptor from './ApiInterceptor';
import AxiosInterceptor from './AxiosInterceptor';
import type { InterceptorConfig } from './types';

export * from './types';

// Engine
export { SyncVault } from './core/SyncVault';
export type { SyncVaultInstance } from './core/SyncVault';
export { uuidv7, isUuidV7 } from './core/uuid';
export { classify, backoffMs, parseRetryAfterMs } from './core/retryPolicy';
export { setNativeImplementation } from './native';

// Hooks
export { useSyncStatus, useQueueStatus, useNetworkState } from './hooks/useSyncStatus';
export { useRequests, usePendingRequests, useFailedRequests, useConflicts, useRequestStatus } from './hooks/useRequests';
export { useOfflineMutation } from './hooks/useOfflineMutation';
export { useOfflineQuery } from './hooks/useOfflineQuery';
export { useCache } from './hooks/useCache';
export { useSyncMetrics } from './hooks/useSyncMetrics';
export { useBackgroundSync } from './hooks/useBackgroundSync';
export { useOfflineQueue } from './hooks/useOfflineQueue';

// Cache
export { default as CacheManager, getCacheManager, configureCache } from './cache/CacheManager';

// Interceptors
export { ApiInterceptor, AxiosInterceptor };

const fetchInterceptor = new ApiInterceptor();
const axiosInterceptor = new AxiosInterceptor();

/** Queue fetch() mutations when offline or on network failure. Returns a disable function. */
export function interceptFetch(config: InterceptorConfig = {}): () => void {
  fetchInterceptor.enable({ ...config, enabled: true });
  return () => fetchInterceptor.disable();
}

/** Queue axios mutations when offline or on network failure. Returns a disable function. */
export function interceptAxios(instance?: unknown, config: InterceptorConfig = {}): () => void {
  axiosInterceptor.enable({ ...config, axios: { enabled: true, instance } }, instance);
  return () => axiosInterceptor.disable();
}

// UI and debug
export { OfflineProvider, useOfflineContext, OfflineStatusBar, QueuedActionsBadge, SyncProgress } from './ui';
export { DebugScreen } from './debug/DebugScreen';
export { SyncDashboard } from './debug/SyncDashboard';
export { QueueLogger } from './debug/QueueLogger';
export { default as SyncMetrics, getSyncMetrics } from './metrics/SyncMetrics';

// Integrations
export {
  syncVaultMutationFn,
  withSyncVaultReactQuery,
  withSyncVaultZustand,
  withSyncVaultRedux,
  createSyncVaultMiddleware,
  SYNC_VAULT_EVENT,
} from './integrations';

// v1 compatibility
export { OfflineQueue } from './compat/OfflineQueue';
import { OfflineQueue } from './compat/OfflineQueue';
export default OfflineQueue;
