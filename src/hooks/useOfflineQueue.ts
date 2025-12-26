import { useCallback, useEffect, useRef, useMemo } from 'react';
import { QueuePushOptions, ApiCallHandler, OfflineQueueConfig } from '../types';

// Lazy import to avoid module evaluation errors
let QueueManager: any;
let SyncEngine: any;
let CacheManager: any;

function getQueueManager() {
  if (!QueueManager) {
    try {
      const module = require('../QueueManager');
      QueueManager = module && module.default ? module.default : null;
      if (!QueueManager) {
        console.warn('QueueManager module loaded but default export is missing');
      }
    } catch (error) {
      console.error('Failed to load QueueManager:', error);
      QueueManager = null;
    }
  }
  return QueueManager;
}

function getSyncEngine() {
  if (!SyncEngine) {
    try {
      const module = require('../SyncEngine');
      SyncEngine = module && module.default ? module.default : null;
      if (!SyncEngine) {
        console.warn('SyncEngine module loaded but default export is missing');
      }
    } catch (error) {
      console.error('Failed to load SyncEngine:', error);
      SyncEngine = null;
    }
  }
  return SyncEngine;
}

function getCacheManager() {
  if (!CacheManager) {
    try {
      const module = require('../cache/CacheManager');
      CacheManager = module && module.default ? module.default : null;
    } catch (error) {
      console.error('Failed to load CacheManager:', error);
      CacheManager = null;
    }
  }
  return CacheManager;
}

function getSmartCacheManager() {
  try {
    const module = require('../cache/SmartCacheManager');
    return module && module.default ? module.default : null;
  } catch (error) {
    console.error('Failed to load SmartCacheManager:', error);
    return null;
  }
}

let syncEngineInstance: any | null = null;
let cacheManagerInstance: any | null = null;

/**
 * Main hook for using the offline queue
 */
export function useOfflineQueue(baseUrlOrConfig?: string | OfflineQueueConfig) {
  // Parse config - support both old API (string) and new API (object)
  const config: OfflineQueueConfig = typeof baseUrlOrConfig === 'string' 
    ? { baseUrl: baseUrlOrConfig }
    : (baseUrlOrConfig || {});
  
  const baseUrl = config.baseUrl;
  const apiCallHandler = config.apiCallHandler;

  // Extract interceptor config for dependency tracking
  const interceptorEnabled = config.interceptor?.enabled ?? false;
  
  // Memoize interceptorUrlFilter array to prevent reference changes
  const interceptorUrlFilterKey = useMemo(() => {
    if (!config.interceptor?.urlFilter) return null;
    return JSON.stringify(config.interceptor.urlFilter);
  }, [config.interceptor?.urlFilter]);

  // Memoize cache and resourceAware configs to prevent unnecessary re-renders
  // Convert objects to stable string representations for dependency comparison
  const cacheConfigKey = useMemo(() => {
    if (!config.cache) return null;
    return JSON.stringify({
      enabled: config.cache.enabled,
      defaultTtl: config.cache.defaultTtl,
      maxSize: config.cache.maxSize,
      strategy: config.cache.strategy,
      strategies: config.cache.strategies,
      invalidateOnMutate: config.cache.invalidateOnMutate,
      invalidateOnError: config.cache.invalidateOnError,
    });
  }, [config.cache?.enabled, config.cache?.defaultTtl, config.cache?.maxSize, config.cache?.strategy, config.cache?.strategies, config.cache?.invalidateOnMutate, config.cache?.invalidateOnError]);

  const resourceAwareConfigKey = useMemo(() => {
    if (!config.resourceAware) return null;
    return JSON.stringify(config.resourceAware);
  }, [config.resourceAware]);
  
  // Memoize apiCallHandler reference to prevent unnecessary re-runs
  // Use a ref to track the previous handler and only update if it actually changed
  const apiCallHandlerRef = useRef(apiCallHandler);
  const apiCallHandlerKey = useMemo(() => {
    // Only update if handler actually changed (by comparing function identity)
    if (apiCallHandler !== apiCallHandlerRef.current) {
      apiCallHandlerRef.current = apiCallHandler;
      return apiCallHandler ? 'handler_changed' : null;
    }
    return apiCallHandler ? 'handler_stable' : null;
  }, [apiCallHandler]);

  const queueManagerRef = useRef(getQueueManager());
  const syncEngineRef = useRef<any | null>(null);
  const cacheManagerRef = useRef<any | null>(null);


  useEffect(() => {
    if (!queueManagerRef.current) {
      console.warn('QueueManager not available');
      return;
    }

    // Initialize queue manager
    try {
      queueManagerRef.current.initialize();
    } catch (error) {
      console.error('Failed to initialize QueueManager:', error);
    }

    // Initialize cache manager if enabled
    if (config.cache?.enabled) {
      if (!cacheManagerInstance) {
        // Use SmartCacheManager if advanced features are configured
        const useSmartCache = 
          config.cache.strategies || 
          config.cache.invalidateOnMutate;
        
        if (useSmartCache) {
          const SmartCacheManagerClass = getSmartCacheManager();
          if (SmartCacheManagerClass) {
            try {
              cacheManagerInstance = new SmartCacheManagerClass(config.cache);
              cacheManagerRef.current = cacheManagerInstance;
              // Initialize asynchronously
              cacheManagerInstance.initialize().catch((error: any) => {
                console.error('Failed to initialize SmartCacheManager:', error);
              });
            } catch (error) {
              console.error('Failed to create SmartCacheManager:', error);
            }
          }
        } else {
          // Use regular CacheManager for simple cases
          const CacheManagerClass = getCacheManager();
          if (CacheManagerClass) {
            try {
              cacheManagerInstance = new CacheManagerClass(config.cache);
              cacheManagerRef.current = cacheManagerInstance;
              // Initialize asynchronously
              cacheManagerInstance.initialize().catch((error: any) => {
                console.error('Failed to initialize CacheManager:', error);
              });
            } catch (error) {
              console.error('Failed to create CacheManager:', error);
            }
          }
        }
      }
    }

    // Initialize sync engine
    if (!syncEngineInstance && queueManagerRef.current) {
      const SyncEngineClass = getSyncEngine();
      if (SyncEngineClass) {
        try {
          syncEngineInstance = new SyncEngineClass(
            queueManagerRef.current,
            apiCallHandler,
            cacheManagerRef.current
          );
          syncEngineRef.current = syncEngineInstance;
        } catch (error) {
          console.error('Failed to create SyncEngine:', error);
        }
      }
    } else if (syncEngineInstance && syncEngineRef.current) {
      // Update apiCallHandler if it changed
      if (apiCallHandler) {
        try {
          syncEngineRef.current.setApiCallHandler(apiCallHandler);
        } catch (error) {
          console.error('Failed to set apiCallHandler:', error);
        }
      }
      // Update cache manager if it changed
      if (cacheManagerRef.current) {
        try {
          syncEngineRef.current.setCacheManager(cacheManagerRef.current);
        } catch (error) {
          console.error('Failed to set cache manager:', error);
        }
      }
    }

    if (baseUrl && syncEngineRef.current) {
      try {
        syncEngineRef.current.setBaseUrl(baseUrl);
      } catch (error) {
        console.error('Failed to set base URL:', error);
      }
    }

    // Start sync if online
    if (syncEngineRef.current) {
      try {
        syncEngineRef.current.startSync();
      } catch (error) {
        console.error('Failed to start sync:', error);
      }
    }

    // Enable automatic API interception if configured
    if (interceptorEnabled && queueManagerRef.current) {
      try {
        queueManagerRef.current.enableAutoInterception(config.interceptor);
      } catch (error) {
        console.error('Failed to enable auto interception:', error);
      }
    }

    return () => {
      // Cleanup on unmount
      if (queueManagerRef.current) {
        try {
          queueManagerRef.current.disableAutoInterception();
        } catch (error) {
          console.error('Failed to disable auto interception:', error);
        }
      }
      if (syncEngineRef.current) {
        try {
          syncEngineRef.current.stopSync();
        } catch (error) {
          console.error('Failed to stop sync:', error);
        }
      }
    };
  }, [baseUrl, apiCallHandlerKey, interceptorEnabled, interceptorUrlFilterKey, cacheConfigKey, resourceAwareConfigKey]);

  /**
   * Push a request to the queue
   */
  const push = useCallback(
    async (options: QueuePushOptions): Promise<string> => {
      if (!queueManagerRef.current) {
        throw new Error('QueueManager not available');
      }
      return queueManagerRef.current.push(options);
    },
    []
  );

  /**
   * Get pending requests
   */
  const getPendingRequests = useCallback(
    async (limit: number = 10, offset: number = 0) => {
      if (!queueManagerRef.current) {
        return [];
      }
      return queueManagerRef.current.getPendingRequests(limit, offset);
    },
    []
  );

  /**
   * Get failed requests
   */
  const getFailedRequests = useCallback(async () => {
    if (!queueManagerRef.current) {
      return [];
    }
    return queueManagerRef.current.getFailedRequests();
  }, []);

  /**
   * Manually trigger sync
   */
  const sync = useCallback(async () => {
    if (syncEngineRef.current) {
      await syncEngineRef.current.startSync();
    }
  }, []);

  return {
    push,
    getPendingRequests,
    getFailedRequests,
    sync,
  };
}


