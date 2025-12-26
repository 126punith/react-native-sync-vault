import { useCallback } from 'react';
import CacheManager from '../cache/CacheManager';

/**
 * Hook for accessing cache
 * Simple wrapper around CacheManager - no internal state needed
 */
export function useCache(cacheManager: CacheManager | null) {
  const get = useCallback(
    async (key: string) => {
      if (!cacheManager) {
        return { hit: false };
      }
      return cacheManager.get(key);
    },
    [cacheManager]
  );

  const set = useCallback(
    async (
      key: string,
      value: any,
      options?: { ttl?: number; tags?: string[] }
    ): Promise<void> => {
      if (!cacheManager) {
        return;
      }
      await cacheManager.set(key, value, options);
    },
    [cacheManager]
  );

  const remove = useCallback(
    async (key: string): Promise<void> => {
      if (!cacheManager) {
        return;
      }
      await cacheManager.delete(key);
    },
    [cacheManager]
  );

  const clear = useCallback(async (): Promise<void> => {
    if (!cacheManager) {
      return;
    }
    await cacheManager.clear();
  }, [cacheManager]);

  const getSize = useCallback(async (): Promise<number> => {
    if (!cacheManager) {
      return 0;
    }
    return cacheManager.getSize();
  }, [cacheManager]);

  return {
    get,
    set,
    remove,
    clear,
    getSize,
    isEnabled: cacheManager?.isEnabled() ?? false,
  };
}

