import { useCallback, useEffect, useRef } from 'react';
import { QueuePushOptions, ApiCallHandler, OfflineQueueConfig } from '../types';

// Lazy import to avoid module evaluation errors
let QueueManager: any;
let SyncEngine: any;

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

let syncEngineInstance: any | null = null;

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

  const queueManagerRef = useRef(getQueueManager());
  const syncEngineRef = useRef<any | null>(null);

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

    // Initialize sync engine
    if (!syncEngineInstance && queueManagerRef.current) {
      const SyncEngineClass = getSyncEngine();
      if (SyncEngineClass) {
        try {
          syncEngineInstance = new SyncEngineClass(queueManagerRef.current, apiCallHandler);
          syncEngineRef.current = syncEngineInstance;
          console.log('[DEBUG] useOfflineQueue() SyncEngine created with apiCallHandler:', !!apiCallHandler);
        } catch (error) {
          console.error('Failed to create SyncEngine:', error);
        }
      }
    } else if (syncEngineInstance && apiCallHandler && syncEngineRef.current) {
      // Update apiCallHandler if it changed
      try {
        syncEngineRef.current.setApiCallHandler(apiCallHandler);
        console.log('[DEBUG] useOfflineQueue() apiCallHandler updated');
      } catch (error) {
        console.error('Failed to set apiCallHandler:', error);
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
    if (config.interceptor?.enabled && queueManagerRef.current) {
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
  }, [baseUrl, apiCallHandler, config.interceptor]);

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


