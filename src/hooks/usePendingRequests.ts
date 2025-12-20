import { useState, useEffect, useCallback } from 'react';
import { QueuedRequest } from '../types';
import QueueManager from '../QueueManager';

/**
 * Hook for getting pending requests
 * @param limit - Maximum number of requests to fetch. Default: 10
 * @param pollInterval - Polling interval in milliseconds. Set to 0 to disable polling. Default: 5000ms
 */
export function usePendingRequests(limit: number = 10, pollInterval: number = 5000) {
  const [pendingRequests, setPendingRequests] = useState<QueuedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPendingRequests = useCallback(async () => {
    try {
      setLoading(true);
      const requests = await QueueManager.getPendingRequests(limit, 0);
      setPendingRequests(requests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchPendingRequests();

    // Only poll if interval is greater than 0
    if (pollInterval > 0) {
      const interval = setInterval(fetchPendingRequests, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchPendingRequests, pollInterval]);

  return {
    pendingRequests,
    loading,
    error,
    refetch: fetchPendingRequests,
  };
}


