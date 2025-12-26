import { useState, useEffect, useCallback } from 'react';
import { FailedRequest } from '../types';
import QueueManager from '../QueueManager';

/**
 * Hook for getting failed requests
 * Uses event listeners instead of polling for reactive updates
 */
export function useFailedRequests() {
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
    // Initial fetch
    fetchFailedRequests();

    // Listen to failed requests change events
    const handleFailedChange = (newFailedRequests: FailedRequest[]) => {
      setFailedRequests(newFailedRequests);
      setError(null);
    };

    // Subscribe to events
    if (QueueManager && typeof QueueManager.on === 'function') {
      QueueManager.on('queue:failed:changed', handleFailedChange);
      QueueManager.on('queue:request:failed', fetchFailedRequests);
      
      return () => {
        QueueManager.off('queue:failed:changed', handleFailedChange);
        QueueManager.off('queue:request:failed', fetchFailedRequests);
      };
    }
  }, [fetchFailedRequests]);

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


