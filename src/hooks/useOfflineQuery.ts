import { useState, useEffect, useCallback } from 'react';
import { useOfflineQueue } from './useOfflineQueue';
import { useSmartCache } from './useSmartCache';
import SmartCacheManager from '../cache/SmartCacheManager';
import { OfflineQueueConfig } from '../types';

/**
 * Query options
 */
export interface UseOfflineQueryOptions {
  ttl?: number; // TTL in milliseconds
  staleWhileRevalidate?: boolean; // Return stale data immediately, refresh in background
  enabled?: boolean; // Enable/disable query
  refetchOnMount?: boolean; // Refetch when component mounts
  refetchOnReconnect?: boolean; // Refetch when network reconnects
}

/**
 * Query result
 */
export interface UseOfflineQueryResult<T = any> {
  data: T | undefined;
  isLoading: boolean;
  isStale: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Offline Query Hook
 * React Query-like hook powered by sync vault cache and queue
 */
export function useOfflineQuery<T = any>(
  endpoint: string,
  options: UseOfflineQueryOptions = {}
): UseOfflineQueryResult<T> {
  const {
    ttl = 8 * 60 * 60 * 1000, // 8 hours default
    staleWhileRevalidate = false,
    enabled = true,
    refetchOnMount = true,
    refetchOnReconnect = true,
  } = options;

  const [config] = useState<OfflineQueueConfig>(() => ({
    cache: {
      enabled: true,
      defaultTtl: ttl / 1000, // Convert to seconds
      strategies: {
        [endpoint]: {
          ttl: ttl / 1000,
          staleWhileRevalidate,
        },
      },
    },
  }));

  const queue = useOfflineQueue(config);
  const [cacheManager, setCacheManager] = useState<SmartCacheManager | null>(null);
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Get cache manager instance
  useEffect(() => {
    // Access cache manager from queue (would need to expose this)
    // For now, create a new instance
    const SmartCacheManagerClass = require('../cache/SmartCacheManager').default;
    if (SmartCacheManagerClass) {
      const manager = new SmartCacheManagerClass(config.cache);
      manager.initialize().then(() => {
        setCacheManager(manager);
      });
    }
  }, [config]);

  const cache = useSmartCache(cacheManager);

  const fetchData = useCallback(async () => {
    if (!enabled || !cacheManager) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cacheResult = await cache.get(endpoint, endpoint);

      if (cacheResult.hit && !cacheResult.stale) {
        // Cache hit - use cached data
        setData(cacheResult.data);
        setIsStale(false);
        setIsLoading(false);

        // If stale-while-revalidate, fetch in background
        if (staleWhileRevalidate) {
          fetchFromNetwork().catch(() => {
            // Ignore background fetch errors
          });
        }
        return;
      }

      if (cacheResult.hit && cacheResult.stale && staleWhileRevalidate) {
        // Stale cache - return immediately, fetch in background
        setData(cacheResult.data);
        setIsStale(true);
        setIsLoading(false);
        fetchFromNetwork().catch(() => {
          // Ignore background fetch errors
        });
        return;
      }

      // Cache miss or not using stale-while-revalidate - fetch from network
      await fetchFromNetwork();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
    }
  }, [enabled, endpoint, cache, cacheManager, staleWhileRevalidate]);

  const fetchFromNetwork = useCallback(async () => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonData = await response.json();

      // Cache the response
      await cache.set(endpoint, jsonData, { endpoint });

      setData(jsonData);
      setIsStale(false);
      setIsLoading(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
      throw error;
    }
  }, [endpoint, cache]);

  useEffect(() => {
    if (enabled && cacheManager) {
      fetchData();
    }
  }, [enabled, endpoint, fetchData, cacheManager, refetchOnMount]);

  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
    isStale,
    error,
    refetch,
  };
}

