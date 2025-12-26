import { useCallback } from 'react';
import SmartCacheManager from '../cache/SmartCacheManager';
import { CacheResult } from '../types';

/**
 * Hook for accessing smart cache
 * Provides enhanced cache functionality with per-endpoint TTL and invalidation
 */
export function useSmartCache(smartCacheManager: SmartCacheManager | null) {
  const get = useCallback(
    async (key: string, endpoint?: string): Promise<CacheResult> => {
      if (!smartCacheManager) {
        return { hit: false };
      }
      return smartCacheManager.get(key, endpoint);
    },
    [smartCacheManager]
  );

  const set = useCallback(
    async (
      key: string,
      value: any,
      options?: {
        ttl?: number;
        tags?: string[];
        endpoint?: string;
      }
    ): Promise<void> => {
      if (!smartCacheManager) {
        return;
      }
      await smartCacheManager.set(key, value, options);
    },
    [smartCacheManager]
  );

  const invalidateOnMutate = useCallback(
    async (method: string, url: string): Promise<void> => {
      if (!smartCacheManager) {
        return;
      }
      await smartCacheManager.invalidateOnMutate(method, url);
    },
    [smartCacheManager]
  );

  const remove = useCallback(
    async (key: string): Promise<void> => {
      if (!smartCacheManager) {
        return;
      }
      await smartCacheManager.delete(key);
    },
    [smartCacheManager]
  );

  const clear = useCallback(async (): Promise<void> => {
    if (!smartCacheManager) {
      return;
    }
    await smartCacheManager.clear();
  }, [smartCacheManager]);

  const getSize = useCallback(async (): Promise<number> => {
    if (!smartCacheManager) {
      return 0;
    }
    return smartCacheManager.getSize();
  }, [smartCacheManager]);

  const getEndpointStrategy = useCallback(
    (endpoint: string) => {
      if (!smartCacheManager) {
        return undefined;
      }
      return smartCacheManager.getEndpointStrategy(endpoint);
    },
    [smartCacheManager]
  );

  return {
    get,
    set,
    invalidateOnMutate,
    remove,
    clear,
    getSize,
    getEndpointStrategy,
    isEnabled: smartCacheManager?.isEnabled() ?? false,
  };
}

