import { useState, useEffect, useCallback } from 'react';
import { QueuedRequest } from '../types';
import QueueManager from '../QueueManager';

/**
 * Hook for getting pending requests
 * Uses event listeners instead of polling for reactive updates
 * @param limit - Maximum number of requests to fetch. Default: 10
 */
export function usePendingRequests(limit: number = 10) {
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
    // Initial fetch
    fetchPendingRequests();

    // Listen to pending requests change events
    const handlePendingChange = (newPendingRequests: QueuedRequest[]) => {
      // Limit the requests to the specified limit
      const limitedRequests = newPendingRequests.slice(0, limit);
      setPendingRequests(limitedRequests);
      setError(null);
    };

    // Subscribe to events
    if (QueueManager && typeof QueueManager.on === 'function') {
      QueueManager.on('queue:pending:changed', handlePendingChange);
      QueueManager.on('queue:request:added', fetchPendingRequests);
      QueueManager.on('queue:request:synced', fetchPendingRequests);
      
      return () => {
        QueueManager.off('queue:pending:changed', handlePendingChange);
        QueueManager.off('queue:request:added', fetchPendingRequests);
        QueueManager.off('queue:request:synced', fetchPendingRequests);
      };
    }
  }, [fetchPendingRequests, limit]);

  return {
    pendingRequests,
    loading,
    error,
    refetch: fetchPendingRequests,
  };
}


