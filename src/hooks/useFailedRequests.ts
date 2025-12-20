import { useState, useEffect, useCallback } from 'react';
import { FailedRequest } from '../types';
import QueueManager from '../QueueManager';

/**
 * Hook for getting failed requests
 * @param pollInterval - Polling interval in milliseconds. Set to 0 to disable polling. Default: 5000ms
 */
export function useFailedRequests(pollInterval: number = 5000) {
  const [failedRequests, setFailedRequests] = useState<FailedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchFailedRequests = useCallback(async () => {
    try {
      setLoading(true);
      const requests = await QueueManager.getFailedRequests();
      setFailedRequests(requests as FailedRequest[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFailedRequests();

    // Only poll if interval is greater than 0
    if (pollInterval > 0) {
      const interval = setInterval(fetchFailedRequests, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchFailedRequests, pollInterval]);

  /**
   * Retry a failed request
   */
  const retry = useCallback(async (requestId: string) => {
    try {
      await QueueManager.updateRequestStatus(requestId, 'pending', {
        retryAfter: null,
        attemptCount: 0,
      });
      await fetchFailedRequests();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [fetchFailedRequests]);

  return {
    failedRequests,
    loading,
    error,
    refetch: fetchFailedRequests,
    retry,
  };
}


