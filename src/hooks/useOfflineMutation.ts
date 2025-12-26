import { useState, useCallback, useEffect } from 'react';
import { useOfflineQueue } from './useOfflineQueue';
import { useSmartCache } from './useSmartCache';
import SmartCacheManager from '../cache/SmartCacheManager';
import { OfflineQueueConfig } from '../types';

/**
 * Mutation options
 */
export interface UseOfflineMutationOptions<TData = any, TVariables = any> {
  fn: (variables: TVariables) => Promise<Response>;
  invalidateOnSuccess?: string[]; // Cache keys to invalidate on success
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
}

/**
 * Mutation result
 */
export interface UseOfflineMutationResult<TData = any, TVariables = any> {
  mutate: (variables: TVariables) => Promise<void>;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Offline Mutation Hook
 * React Query-like mutation hook powered by sync vault queue
 */
export function useOfflineMutation<TData = any, TVariables = any>(
  options: UseOfflineMutationOptions<TData, TVariables>
): UseOfflineMutationResult<TData, TVariables> {
  const { fn, invalidateOnSuccess = [], onSuccess, onError } = options;

  const [config] = useState<OfflineQueueConfig>(() => ({
    cache: {
      enabled: true,
      invalidateOnMutate: {},
    },
  }));

  const queue = useOfflineQueue(config);
  const [cacheManager, setCacheManager] = useState<SmartCacheManager | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Get cache manager instance
  useEffect(() => {
    const SmartCacheManagerClass = require('../cache/SmartCacheManager').default;
    if (SmartCacheManagerClass && !cacheManager) {
      const manager = new SmartCacheManagerClass(config.cache);
      manager.initialize().then(() => {
        setCacheManager(manager);
      }).catch(() => {
        // Ignore initialization errors
      });
    }
  }, [config, cacheManager]);

  const cache = useSmartCache(cacheManager);

  const mutate = useCallback(
    async (variables: TVariables) => {
      setIsPending(true);
      setError(null);

      try {
        // Extract URL from function (would need to parse or pass separately)
        // For now, assume fn returns a Response with URL info
        const response = await fn(variables);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Invalidate cache if configured
        if (invalidateOnSuccess.length > 0 && cacheManager) {
          await Promise.all(
            invalidateOnSuccess.map((key) => cache.invalidateOnMutate('POST', key))
          );
        }

        onSuccess?.(data);
        setIsPending(false);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsPending(false);
        onError?.(error);
        throw error;
      }
    },
    [fn, invalidateOnSuccess, cache, cacheManager, onSuccess, onError]
  );

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      setIsPending(true);
      setError(null);

      try {
        const response = await fn(variables);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Invalidate cache if configured
        if (invalidateOnSuccess.length > 0 && cacheManager) {
          await Promise.all(
            invalidateOnSuccess.map((key) => cache.invalidateOnMutate('POST', key))
          );
        }

        onSuccess?.(data);
        setIsPending(false);
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsPending(false);
        onError?.(error);
        throw error;
      }
    },
    [fn, invalidateOnSuccess, cache, cacheManager, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPending(false);
  }, []);

  return {
    mutate,
    mutateAsync,
    isPending,
    error,
    reset,
  };
}

