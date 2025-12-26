import { useState, useEffect, useCallback } from 'react';
import { NativeModules } from 'react-native';
import { SyncStatus } from '../types';
import QueueManager from '../QueueManager';

// Get native module with error handling
let NativeModule: any = null;
try {
  NativeModule = NativeModules.OfflineQueue;
} catch (error) {
  console.warn('Failed to access native module in useQueueStatus:', error);
}

/**
 * Hook for getting real-time queue status
 * Uses event listeners instead of polling for reactive updates
 */
export function useQueueStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      if (!NativeModule) {
        // Silently handle - warning already shown at module load
        setStatus(null);
        setError(null);
        return;
      }
      
      const syncStatus = await NativeModule.getSyncStatus();
      
      // Get current network status
      const networkMonitor = QueueManager.getNetworkMonitor();
      const networkStatus = networkMonitor.getStatus();
      
      setStatus({
        ...syncStatus,
        networkStatus,
      } as SyncStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Listen to status change events
    const handleStatusChange = async (newStatus: any) => {
      try {
        if (!NativeModule) {
          return;
        }
        
        const syncStatus = await NativeModule.getSyncStatus();
        const networkMonitor = QueueManager.getNetworkMonitor();
        const networkStatus = networkMonitor.getStatus();
        
        setStatus({
          ...syncStatus,
          networkStatus,
          ...newStatus,
        } as SyncStatus);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    // Subscribe to events
    if (QueueManager && typeof QueueManager.on === 'function') {
      QueueManager.on('queue:status:changed', handleStatusChange);
      
      return () => {
        QueueManager.off('queue:status:changed', handleStatusChange);
      };
    }
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
  };
}

