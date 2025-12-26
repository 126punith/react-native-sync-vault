import { CacheStrategy as CacheStrategyType, CacheResult, ApiCallResponse } from '../types';
import CacheManager from './CacheManager';

/**
 * Cache Strategy Handler
 * Implements different caching strategies: cache-first, network-first, stale-while-revalidate
 */
class CacheStrategy {
  private cacheManager: CacheManager;
  private strategy: CacheStrategyType;

  constructor(cacheManager: CacheManager, strategy: CacheStrategyType = 'network-first') {
    this.cacheManager = cacheManager;
    this.strategy = strategy;
  }

  /**
   * Execute request with cache strategy
   */
  async execute(
    key: string,
    networkRequest: () => Promise<ApiCallResponse>,
    options?: {
      ttl?: number;
      tags?: string[];
    }
  ): Promise<ApiCallResponse> {
    switch (this.strategy) {
      case 'cache-first':
        return this.cacheFirst(key, networkRequest, options);
      case 'network-first':
        return this.networkFirst(key, networkRequest, options);
      case 'stale-while-revalidate':
        return this.staleWhileRevalidate(key, networkRequest, options);
      default:
        return this.networkFirst(key, networkRequest, options);
    }
  }

  /**
   * Cache-first strategy: Check cache first, fallback to network
   */
  private async cacheFirst(
    key: string,
    networkRequest: () => Promise<ApiCallResponse>,
    options?: { ttl?: number; tags?: string[] }
  ): Promise<ApiCallResponse> {
    // Check cache first
    const cacheResult = await this.cacheManager.get(key);

    if (cacheResult.hit && !cacheResult.stale) {
      // Cache hit - return cached data
      return this.createResponseFromCache(cacheResult.data!);
    }

    // Cache miss or stale - fetch from network
    try {
      const response = await networkRequest();

      // Cache successful responses
      if (response.ok) {
        const data = await response.json();
        await this.cacheManager.set(key, data, options);
      }

      return response;
    } catch (error) {
      // Network error - return stale cache if available
      if (cacheResult.hit) {
        if (__DEV__) {
          console.warn('Network error, returning stale cache:', error);
        }
        return this.createResponseFromCache(cacheResult.data!);
      }
      throw error;
    }
  }

  /**
   * Network-first strategy: Try network first, fallback to cache
   */
  private async networkFirst(
    key: string,
    networkRequest: () => Promise<ApiCallResponse>,
    options?: { ttl?: number; tags?: string[] }
  ): Promise<ApiCallResponse> {
    try {
      // Try network first
      const response = await networkRequest();

      // Cache successful responses
      if (response.ok) {
        const data = await response.json();
        await this.cacheManager.set(key, data, options);
      }

      return response;
    } catch (error) {
      // Network error - try cache
      const cacheResult = await this.cacheManager.get(key);

      if (cacheResult.hit) {
        if (__DEV__) {
          console.warn('Network error, returning cache:', error);
        }
        return this.createResponseFromCache(cacheResult.data!);
      }

      // No cache available - throw error
      throw error;
    }
  }

  /**
   * Stale-while-revalidate strategy: Return cache immediately, refresh in background
   */
  private async staleWhileRevalidate(
    key: string,
    networkRequest: () => Promise<ApiCallResponse>,
    options?: { ttl?: number; tags?: string[] }
  ): Promise<ApiCallResponse> {
    // Check cache first
    const cacheResult = await this.cacheManager.get(key);

    // Start network request in background (don't await)
    const networkPromise = networkRequest()
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          await this.cacheManager.set(key, data, options);
        }
        return response;
      })
      .catch((error) => {
        if (__DEV__) {
          console.warn('Background refresh failed:', error);
        }
        return null;
      });

    // If cache hit, return immediately
    if (cacheResult.hit) {
      // Return cached response immediately
      const cachedResponse = this.createResponseFromCache(cacheResult.data!);
      
      // Background refresh will update cache for next time
      networkPromise.catch(() => {
        // Ignore background errors
      });

      return cachedResponse;
    }

    // No cache - wait for network
    const response = await networkPromise;
    if (response) {
      return response;
    }

    // Network failed and no cache - throw error
    throw new Error('Network request failed and no cache available');
  }

  /**
   * Create Response object from cached data
   */
  private createResponseFromCache(data: any): ApiCallResponse {
    return {
      ok: true,
      status: 200,
      statusText: 'OK (Cached)',
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: {
        'X-Cache': 'HIT',
        'Content-Type': 'application/json',
      },
    };
  }

  /**
   * Set cache strategy
   */
  setStrategy(strategy: CacheStrategyType): void {
    this.strategy = strategy;
  }

  /**
   * Get current strategy
   */
  getStrategy(): CacheStrategyType {
    return this.strategy;
  }
}

export default CacheStrategy;

