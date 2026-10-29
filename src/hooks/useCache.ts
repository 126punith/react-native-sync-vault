import { useCallback, useEffect, useRef, useState } from 'react';
import { getCacheManager, type CacheSetOptions } from '../cache/CacheManager';

export interface UseCacheResult<T> {
  data: T | undefined;
  isStale: boolean;
  loading: boolean;
  set: (value: T, options?: CacheSetOptions) => Promise<void>;
  remove: () => Promise<void>;
  reload: () => Promise<void>;
}

/** Reads and writes a single entry of the persistent cache. */
export function useCache<T = unknown>(key: string): UseCacheResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCacheManager().get<T>(key);
      if (!mounted.current) return;
      setData(result.hit ? result.data : undefined);
      setIsStale(!!result.stale);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const set = useCallback(
    async (value: T, options?: CacheSetOptions) => {
      await getCacheManager().set(key, value, options);
      if (mounted.current) {
        setData(value);
        setIsStale(false);
      }
    },
    [key]
  );

  const remove = useCallback(async () => {
    await getCacheManager().delete(key);
    if (mounted.current) setData(undefined);
  }, [key]);

  return { data, isStale, loading, set, remove, reload };
}
