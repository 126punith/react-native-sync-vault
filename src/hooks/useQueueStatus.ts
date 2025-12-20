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
 * @param pollInterval - Polling interval in milliseconds. Set to 0 to disable polling. Default: 5000ms
 */
export function useQueueStatus(pollInterval: number = 5000) {
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
    fetchStatus();

    // Only poll if interval is greater than 0
    if (pollInterval > 0) {
      const interval = setInterval(fetchStatus, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchStatus, pollInterval]);

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
  };
}

