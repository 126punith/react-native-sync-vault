import CacheManager from './CacheManager';

/**
 * Cache Invalidation Manager
 * Handles TTL-based and tag-based cache invalidation
 */
class CacheInvalidation {
  private cacheManager: CacheManager;
  private evictionInterval: NodeJS.Timeout | null = null;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Start automatic expiration of expired cache entries
   */
  startAutoEviction(intervalMs: number = 60000): void {
    // Evict expired entries every minute by default
    if (this.evictionInterval) {
      this.stopAutoEviction();
    }

    this.evictionInterval = setInterval(async () => {
      try {
        await this.cacheManager.evictExpired();
      } catch (error) {
        if (__DEV__) {
          console.error('Auto eviction error:', error);
        }
      }
    }, intervalMs);

    // Also evict immediately
    this.cacheManager.evictExpired().catch((error) => {
      if (__DEV__) {
        console.error('Initial eviction error:', error);
      }
    });
  }

  /**
   * Stop automatic eviction
   */
  stopAutoEviction(): void {
    if (this.evictionInterval) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    await this.cacheManager.invalidateByTags(tags);
  }

  /**
   * Invalidate all cache
   */
  async invalidateAll(): Promise<void> {
    await this.cacheManager.clear();
  }

  /**
   * Invalidate cache for specific URL
   */
  async invalidateUrl(url: string, method: string = 'GET'): Promise<void> {
    const key = method === 'GET' ? url.split('?')[0] : url;
    await this.cacheManager.delete(`${method}:${key}`);
  }
}

export default CacheInvalidation;

