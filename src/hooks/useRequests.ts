import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SyncVault } from '../core/SyncVault';
import type { ConflictResolution, RequestQuery, SyncRequest } from '../core/types';
import { statusStore } from './statusStore';

export interface RequestsResult {
  requests: SyncRequest[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function useEventVersion(): number {
  return useSyncExternalStore(
    statusStore.subscribe,
    () => statusStore.getSnapshot().version,
    () => statusStore.getSnapshot().version
  );
}

/** Live list of outbox requests matching `query`, refreshed on engine events. */
export function useRequests(query: RequestQuery = {}): RequestsResult {
  const [requests, setRequests] = useState<SyncRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const version = useEventVersion();
  const key = JSON.stringify(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await SyncVault.getRequests(queryRef.current);
      if (!mounted.current) return;
      setRequests(rows);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [key, version, refresh]);

  return { requests, loading, error, refresh };
}

export function usePendingRequests(limit = 100): RequestsResult {
  return useRequests({ status: ['pending', 'inflight'], limit });
}

export interface FailedRequestsResult extends RequestsResult {
  retry: (id: string) => Promise<void>;
  retryAll: () => Promise<number>;
  discard: (id: string) => Promise<void>;
}

/** Dead-lettered requests with actions to retry or discard them. */
export function useFailedRequests(limit = 100): FailedRequestsResult {
  const result = useRequests({ status: 'dead_letter', limit });
  const retry = useCallback((id: string) => SyncVault.retry(id), []);
  const retryAll = useCallback(() => SyncVault.retryAllDeadLetters(), []);
  const discard = useCallback((id: string) => SyncVault.discard(id), []);
  return { ...result, retry, retryAll, discard };
}

export interface ConflictsResult extends RequestsResult {
  resolve: (id: string, resolution: ConflictResolution) => Promise<void>;
}

export function useConflicts(limit = 100): ConflictsResult {
  const result = useRequests({ status: 'conflict', limit });
  const resolve = useCallback((id: string, resolution: ConflictResolution) => SyncVault.resolveConflict(id, resolution), []);
  return { ...result, resolve };
}

/** Tracks a single request (e.g. the one returned by enqueue) until it settles. */
export function useRequestStatus(id: string | null | undefined): SyncRequest | null {
  const [request, setRequest] = useState<SyncRequest | null>(null);
  const lastEvent = useSyncExternalStore(
    statusStore.subscribe,
    () => statusStore.getSnapshot().lastEvent,
    () => statusStore.getSnapshot().lastEvent
  );
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (id && lastEvent?.id === id) setVersion((v) => v + 1);
  }, [id, lastEvent]);
  useEffect(() => {
    let active = true;
    if (!id) {
      setRequest(null);
      return;
    }
    SyncVault.getRequest(id)
      .then((row) => {
        if (active) setRequest(row);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id, version]);
  return request;
}
