/**
 * react-native-sync-vault
 * Main entry point for the library
 */

// Helper function to safely export modules
function safeExport(name: string, requireFn: () => any, defaultValue: any = null): any {
  try {
    return requireFn();
  } catch (error) {
    if (__DEV__) {
      console.error(`Failed to load ${name}:`, error);
    }
    return defaultValue;
  }
}

// Export types first (no dependencies)
try {
  const types = require('./types');
  Object.keys(types).forEach((key) => {
    (exports as any)[key] = types[key];
  });
} catch (error) {
  if (__DEV__) {
    console.error('Failed to export types:', error);
  }
}

// Export classes and utilities
const OfflineQueueExport = safeExport('OfflineQueue', () => require('./QueueManager').default);
const SyncEngineExport = safeExport('SyncEngine', () => require('./SyncEngine').default);
const NetworkMonitorExport = safeExport('NetworkMonitor', () => require('./NetworkMonitor').default);
const ConflictResolverExport = safeExport('ConflictResolver', () => require('./ConflictResolver').default);

export { OfflineQueueExport as OfflineQueue };
export { SyncEngineExport as SyncEngine };
export { NetworkMonitorExport as NetworkMonitor };
export { ConflictResolverExport as ConflictResolver };

// Export hooks
const useOfflineQueueExport = safeExport('useOfflineQueue', () => require('./hooks/useOfflineQueue').useOfflineQueue, () => {
  throw new Error('useOfflineQueue not available');
});
const useQueueStatusExport = safeExport('useQueueStatus', () => require('./hooks/useQueueStatus').useQueueStatus, () => {
  throw new Error('useQueueStatus not available');
});
const useFailedRequestsExport = safeExport('useFailedRequests', () => require('./hooks/useFailedRequests').useFailedRequests, () => {
  throw new Error('useFailedRequests not available');
});
const usePendingRequestsExport = safeExport('usePendingRequests', () => require('./hooks/usePendingRequests').usePendingRequests, () => {
  throw new Error('usePendingRequests not available');
});

export { useOfflineQueueExport as useOfflineQueue };
export { useQueueStatusExport as useQueueStatus };
export { useFailedRequestsExport as useFailedRequests };
export { usePendingRequestsExport as usePendingRequests };

// Export debug tools
const DebugScreenExport = safeExport('DebugScreen', () => require('./debug/DebugScreen').DebugScreen);
const QueueLoggerExport = safeExport('QueueLogger', () => require('./debug/QueueLogger').QueueLogger);

export { DebugScreenExport as DebugScreen };
export { QueueLoggerExport as QueueLogger };

// Export ApiInterceptor
const ApiInterceptorExport = safeExport('ApiInterceptor', () => require('./ApiInterceptor').default);
const AxiosInterceptorExport = safeExport('AxiosInterceptor', () => require('./AxiosInterceptor').default);

export { ApiInterceptorExport as ApiInterceptor };
export { AxiosInterceptorExport as AxiosInterceptor };

// Export cache classes
const CacheManagerExport = safeExport('CacheManager', () => require('./cache/CacheManager').default);
const SmartCacheManagerExport = safeExport('SmartCacheManager', () => require('./cache/SmartCacheManager').default);
const CacheStrategyExport = safeExport('CacheStrategy', () => require('./cache/CacheStrategy').default);
const CacheInvalidationExport = safeExport('CacheInvalidation', () => require('./cache/CacheInvalidation').default);
const InvalidationEngineExport = safeExport('InvalidationEngine', () => require('./cache/InvalidationEngine').default);

export { CacheManagerExport as CacheManager };
export { SmartCacheManagerExport as SmartCacheManager };
export { CacheStrategyExport as CacheStrategy };
export { CacheInvalidationExport as CacheInvalidation };
export { InvalidationEngineExport as InvalidationEngine };

// Export cache hooks
const useCacheExport = safeExport('useCache', () => require('./hooks/useCache').useCache, () => {
  throw new Error('useCache not available');
});
const useSmartCacheExport = safeExport('useSmartCache', () => require('./hooks/useSmartCache').useSmartCache, () => {
  throw new Error('useSmartCache not available');
});

export { useCacheExport as useCache };
export { useSmartCacheExport as useSmartCache };

// Export resource management
const ResourceManagerExport = safeExport('ResourceManager', () => require('./resources/ResourceManager').default);
const BatteryMonitorExport = safeExport('BatteryMonitor', () => require('./resources/BatteryMonitor').default);
const NetworkQualityDetectorExport = safeExport('NetworkQualityDetector', () => require('./resources/NetworkQualityDetector').default);
const ResourceAwareSyncExport = safeExport('ResourceAwareSync', () => require('./sync/ResourceAwareSync').default);
const useResourceAwareSyncExport = safeExport('useResourceAwareSync', () => require('./hooks/useResourceAwareSync').useResourceAwareSync, () => {
  throw new Error('useResourceAwareSync not available');
});

export { ResourceManagerExport as ResourceManager };
export { BatteryMonitorExport as BatteryMonitor };
export { NetworkQualityDetectorExport as NetworkQualityDetector };
export { ResourceAwareSyncExport as ResourceAwareSync };
export { useResourceAwareSyncExport as useResourceAwareSync };

// Export background sync
const BackgroundSyncExport = safeExport('BackgroundSync', () => require('./background/BackgroundSync').default);
const TaskSchedulerExport = safeExport('TaskScheduler', () => require('./background/TaskScheduler').default);
const useBackgroundSyncExport = safeExport('useBackgroundSync', () => require('./hooks/useBackgroundSync').useBackgroundSync, () => {
  throw new Error('useBackgroundSync not available');
});

export { BackgroundSyncExport as BackgroundSync };
export { TaskSchedulerExport as TaskScheduler };
export { useBackgroundSyncExport as useBackgroundSync };

// Export UI components
const uiModule = safeExport('UI components', () => require('./ui'), {});
const OfflineProviderExport = uiModule?.OfflineProvider || null;
const OfflineStatusBarExport = uiModule?.OfflineStatusBar || null;
const QueuedActionsBadgeExport = uiModule?.QueuedActionsBadge || null;
const SyncProgressExport = uiModule?.SyncProgress || null;

export { OfflineProviderExport as OfflineProvider };
export { OfflineStatusBarExport as OfflineStatusBar };
export { QueuedActionsBadgeExport as QueuedActionsBadge };
export { SyncProgressExport as SyncProgress };

// Export offline-ready hooks
const useOfflineQueryExport = safeExport('useOfflineQuery', () => require('./hooks/useOfflineQuery').useOfflineQuery, () => {
  throw new Error('useOfflineQuery not available');
});
const useOfflineMutationExport = safeExport('useOfflineMutation', () => require('./hooks/useOfflineMutation').useOfflineMutation, () => {
  throw new Error('useOfflineMutation not available');
});

export { useOfflineQueryExport as useOfflineQuery };
export { useOfflineMutationExport as useOfflineMutation };

// Export metrics
const SyncMetricsExport = safeExport('SyncMetrics', () => require('./metrics/SyncMetrics').default);
const MetricsCollectorExport = safeExport('MetricsCollector', () => require('./metrics/MetricsCollector').default);
const useSyncMetricsExport = safeExport('useSyncMetrics', () => require('./hooks/useSyncMetrics').useSyncMetrics, () => {
  throw new Error('useSyncMetrics not available');
});
const SyncDashboardExport = safeExport('SyncDashboard', () => require('./debug/SyncDashboard').SyncDashboard);

export { SyncMetricsExport as SyncMetrics };
export { MetricsCollectorExport as MetricsCollector };
export { useSyncMetricsExport as useSyncMetrics };
export { SyncDashboardExport as SyncDashboard };

// Export integrations
const integrations = safeExport('integrations', () => require('./integrations'), {});
const ReactQueryIntegrationExport = integrations ? {
  withSyncVault: integrations.withSyncVaultReactQuery,
  useReactQueryWithSyncVault: integrations.useReactQueryWithSyncVault,
} : null;
const ZustandIntegrationExport = integrations ? {
  withSyncVault: integrations.withSyncVaultZustand,
  useZustandWithSyncVault: integrations.useZustandWithSyncVault,
} : null;
const ReduxIntegrationExport = integrations ? {
  withSyncVault: integrations.withSyncVaultRedux,
  createSyncVaultMiddleware: integrations.createSyncVaultMiddleware,
} : null;

export { ReactQueryIntegrationExport as ReactQueryIntegration };
export { ZustandIntegrationExport as ZustandIntegration };
export { ReduxIntegrationExport as ReduxIntegration };

// Default export - main queue instance
export default OfflineQueueExport;


