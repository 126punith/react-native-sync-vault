import { useCallback, useRef, useState } from 'react';
import { SyncVault } from '../core/SyncVault';
import type { EnqueueOptions } from '../core/types';
import { getCacheManager } from '../cache/CacheManager';

export interface UseOfflineMutationOptions<TVariables> {
  /** Maps variables to the request to queue. */
  request: (variables: TVariables) => EnqueueOptions;
  /** Cache paths or patterns to invalidate once the request is queued. */
  invalidate?: string[];
  /** Apply local state changes immediately; the request is durable from this point. */
  onQueued?: (requestId: string, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
}

export interface UseOfflineMutationResult<TVariables> {
  /** Resolves with the request id once the request is durably queued. */
  mutate: (variables: TVariables) => Promise<string>;
  isPending: boolean;
  error: Error | null;
  lastRequestId: string | null;
  reset: () => void;
}

/**
 * Offline-first mutation: the request is committed to the native outbox and delivered with
 * retries, ordering, and idempotency, even if the app is killed. Track delivery of
 * `lastRequestId` with useRequestStatus().
 */
export function useOfflineMutation<TVariables = void>(
  options: UseOfflineMutationOptions<TVariables>
): UseOfflineMutationResult<TVariables> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback(async (variables: TVariables) => {
    const { request, invalidate = [], onQueued, onError } = optionsRef.current;
    setIsPending(true);
    setError(null);
    try {
      const enqueue = request(variables);
      const id = await SyncVault.enqueue(enqueue);
      setLastRequestId(id);
      onQueued?.(id, variables);
      const cache = getCacheManager();
      await Promise.all([
        ...invalidate.map((pattern) => cache.invalidate(pattern)),
        cache.invalidateOnMutate(enqueue.method, enqueue.url),
      ]).catch(() => undefined);
      return id;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      onError?.(err, variables);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLastRequestId(null);
  }, []);

  return { mutate, isPending, error, lastRequestId, reset };
}
