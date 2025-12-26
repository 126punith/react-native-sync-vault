import CacheManager from './CacheManager';

/**
 * Invalidation Rule Pattern
 */
export interface InvalidationRule {
  pattern: string; // e.g., 'POST /api/assignments'
  invalidate: string[]; // Patterns to invalidate, e.g., ['/api/assignments', '/api/assignments/*']
}

/**
 * Invalidation Engine
 * Handles pattern-based cache invalidation
 */
class InvalidationEngine {
  private cacheManager: CacheManager;
  private rules: Map<string, InvalidationRule[]> = new Map();

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Register invalidation rules
   */
  registerRules(rules: Record<string, string[]>): void {
    Object.entries(rules).forEach(([pattern, invalidate]) => {
      const method = pattern.split(' ')[0].toUpperCase();
      const urlPattern = pattern.substring(pattern.indexOf(' ') + 1);

      if (!this.rules.has(method)) {
        this.rules.set(method, []);
      }

      this.rules.get(method)!.push({
        pattern: urlPattern,
        invalidate,
      });
    });
  }

  /**
   * Invalidate cache based on mutation
   */
  async invalidateOnMutate(method: string, url: string): Promise<void> {
    const upperMethod = method.toUpperCase();
    const methodRules = this.rules.get(upperMethod) || [];

    // Find matching rules
    const matchingRules = methodRules.filter((rule) =>
      this.matchPattern(rule.pattern, url)
    );

    if (matchingRules.length === 0) {
      return;
    }

    // Collect all patterns to invalidate
    const patternsToInvalidate = new Set<string>();
    matchingRules.forEach((rule) => {
      rule.invalidate.forEach((pattern) => {
        patternsToInvalidate.add(pattern);
      });
    });

    // Invalidate matching cache entries
    await Promise.all(
      Array.from(patternsToInvalidate).map((pattern) =>
        this.invalidatePattern(pattern)
      )
    );
  }

  /**
   * Match URL pattern (supports wildcards)
   */
  private matchPattern(pattern: string, url: string): boolean {
    // Convert pattern to regex
    // Support wildcards: * matches any segment, ** matches any path
    const regexPattern = pattern
      .replace(/\*\*/g, '.*') // ** matches any path
      .replace(/\*/g, '[^/]*') // * matches any segment
      .replace(/:[^/]+/g, '[^/]+'); // :id matches any segment

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(url);
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  private async invalidatePattern(pattern: string): Promise<void> {
    try {
      // Get all cache keys
      const allKeys = await this.getAllCacheKeys();

      // Find matching keys
      const matchingKeys = allKeys.filter((key) => {
        // Extract URL from cache key (format: "METHOD:URL")
        const url = key.includes(':') ? key.split(':').slice(1).join(':') : key;
        return this.matchPattern(pattern, url);
      });

      // Delete matching entries
      await Promise.all(
        matchingKeys.map((key) => this.cacheManager.delete(key))
      );
      } catch (error) {
        if (__DEV__) {
          console.error('Error invalidating pattern:', pattern, error);
        }
      }
  }

  /**
   * Get all cache keys (for pattern matching)
   */
  private async getAllCacheKeys(): Promise<string[]> {
    // This would require a method in CacheManager to list all keys
    // For now, we'll use a workaround by querying the database directly
    try {
      const { NativeModules } = require('react-native');
      const NativeModule = NativeModules.OfflineQueue;

      if (!NativeModule) {
        return [];
      }

      const query = `SELECT key FROM response_cache`;
      const results = await NativeModule.executeSql(query, []);

      return (results || []).map((row: any) => row.key);
    } catch (error) {
      if (__DEV__) {
        console.error('Error getting cache keys:', error);
      }
      return [];
    }
  }

  /**
   * Clear all invalidation rules
   */
  clearRules(): void {
    this.rules.clear();
  }
}

export default InvalidationEngine;

