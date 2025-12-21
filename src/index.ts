/**
 * react-native-sync-vault
 * Main entry point for the library
 */

// Export types first (no dependencies) - wrapped in try-catch for safety
try {
  const types = require('./types');
  Object.keys(types).forEach((key) => {
    (exports as any)[key] = types[key];
  });
} catch (error) {
  console.error('Failed to export types:', error);
}

// Export classes and utilities using require() to avoid immediate evaluation
let OfflineQueueExport: any;
let SyncEngineExport: any;
let NetworkMonitorExport: any;
let ConflictResolverExport: any;

try {
  OfflineQueueExport = require('./QueueManager').default;
} catch (error) {
  console.error('Failed to load OfflineQueue:', error);
  OfflineQueueExport = null;
}

try {
  SyncEngineExport = require('./SyncEngine').default;
} catch (error) {
  console.error('Failed to load SyncEngine:', error);
  SyncEngineExport = null;
}

try {
  NetworkMonitorExport = require('./NetworkMonitor').default;
} catch (error) {
  console.error('Failed to load NetworkMonitor:', error);
  NetworkMonitorExport = null;
}

try {
  ConflictResolverExport = require('./ConflictResolver').default;
} catch (error) {
  console.error('Failed to load ConflictResolver:', error);
  ConflictResolverExport = null;
}

export { OfflineQueueExport as OfflineQueue };
export { SyncEngineExport as SyncEngine };
export { NetworkMonitorExport as NetworkMonitor };
export { ConflictResolverExport as ConflictResolver };

// Export hooks - import first, then export to handle errors gracefully
let useOfflineQueueExport: any;
let useQueueStatusExport: any;
let useFailedRequestsExport: any;
let usePendingRequestsExport: any;

try {
  useOfflineQueueExport = require('./hooks/useOfflineQueue').useOfflineQueue;
} catch (error) {
  console.error('Failed to import useOfflineQueue:', error);
  useOfflineQueueExport = () => {
    throw new Error('useOfflineQueue not available');
  };
}

try {
  useQueueStatusExport = require('./hooks/useQueueStatus').useQueueStatus;
} catch (error) {
  console.error('Failed to import useQueueStatus:', error);
  useQueueStatusExport = () => {
    throw new Error('useQueueStatus not available');
  };
}

try {
  useFailedRequestsExport = require('./hooks/useFailedRequests').useFailedRequests;
} catch (error) {
  console.error('Failed to import useFailedRequests:', error);
  useFailedRequestsExport = () => {
    throw new Error('useFailedRequests not available');
  };
}

try {
  usePendingRequestsExport = require('./hooks/usePendingRequests').usePendingRequests;
} catch (error) {
  console.error('Failed to import usePendingRequests:', error);
  usePendingRequestsExport = () => {
    throw new Error('usePendingRequests not available');
  };
}

export { useOfflineQueueExport as useOfflineQueue };
export { useQueueStatusExport as useQueueStatus };
export { useFailedRequestsExport as useFailedRequests };
export { usePendingRequestsExport as usePendingRequests };

// Export debug tools
let DebugScreenExport: any;
let QueueLoggerExport: any;

try {
  DebugScreenExport = require('./debug/DebugScreen').DebugScreen;
} catch (error) {
  console.error('Failed to load DebugScreen:', error);
  DebugScreenExport = null;
}

try {
  QueueLoggerExport = require('./debug/QueueLogger').QueueLogger;
} catch (error) {
  console.error('Failed to load QueueLogger:', error);
  QueueLoggerExport = null;
}

export { DebugScreenExport as DebugScreen };
export { QueueLoggerExport as QueueLogger };

// Export ApiInterceptor
let ApiInterceptorExport: any;
try {
  ApiInterceptorExport = require('./ApiInterceptor').default;
} catch (error) {
  console.error('Failed to load ApiInterceptor:', error);
  ApiInterceptorExport = null;
}

export { ApiInterceptorExport as ApiInterceptor };

// Default export - main queue instance
export default OfflineQueueExport;


