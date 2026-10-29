import { useCallback, useEffect, useRef, useState } from 'react';
import { getCacheManager } from '../cache/CacheManager';
import type { CacheStrategy } from '../types';
import { useNetworkState } from './useSyncStatus';

export interface UseOfflineQueryOptions<T> {
  /** Defaults to fetch(url) + JSON. Auth is the caller's concern for reads. */
  fetcher?: () => Promise<T>;
  /** TTL in seconds. Default: cache config default (3600). */
  ttl?: number;
  strategy?: CacheStrategy;
  tags?: string[];
  enabled?: boolean;
  refetchOnReconnect?: boolean;
}

export interface UseOfflineQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isStale: boolean;
  fromCache: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

async function defaultFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Cached read that keeps working offline (falls back to the last cached copy). */
export function useOfflineQuery<T = unknown>(url: string, options: UseOfflineQueryOptions<T> = {}): UseOfflineQueryResult<T> {
  const { enabled = true, refetchOnReconnect = true } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isStale, setIsStale] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mounted = useRef(true);
  const network = useNetworkState();
  const wasConnected = useRef(network.isConnected);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    const { fetcher, ttl, strategy, tags } = optionsRef.current;
    setIsLoading(true);
    try {
      const result = await getCacheManager().fetch<T>(url, fetcher ?? (() => defaultFetch<T>(url)), {
        ttl,
        strategy,
        tags,
        endpoint: url,
      });
      if (!mounted.current) return;
      setData(result.data);
      setIsStale(result.stale);
      setFromCache(result.fromCache);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  useEffect(() => {
    const cameOnline = !wasConnected.current && network.isConnected;
    wasConnected.current = network.isConnected;
    if (cameOnline && enabled && refetchOnReconnect) void refetch();
  }, [network.isConnected, enabled, refetchOnReconnect, refetch]);

  return { data, isLoading, isStale, fromCache, error, refetch };
}
