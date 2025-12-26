import { CacheEntry, CacheConfig, CacheResult } from '../types';
import { generateRequestId } from '../utils/idGenerator';
import { getNativeModule } from '../utils/nativeModule';

// Get native module
const NativeModule = getNativeModule();

/**
 * Cache Manager - Handles response caching with SQLite storage
 */
class CacheManager {
  private config: CacheConfig;
  private isInitialized: boolean = false;
  private cacheTableName: string = 'response_cache';

  constructor(config: CacheConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultTtl: config.defaultTtl ?? 3600, // 1 hour default
      maxSize: config.maxSize ?? 50 * 1024 * 1024, // 50MB default
      strategy: config.strategy ?? 'network-first',
      invalidateOnError: config.invalidateOnError ?? false,
    };
  }

  /**
   * Initialize cache manager and create cache table
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!NativeModule) {
      if (__DEV__) {
        console.warn('Native module not available. Cache will not work.');
      }
      return;
    }

    try {
      // Create cache table if it doesn't exist
      await this.createCacheTable();
      this.isInitialized = true;
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to initialize cache:', error);
      }
      throw error;
    }
  }

  /**
   * Create cache table in SQLite
   */
  private async createCacheTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${this.cacheTableName} (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        ttl INTEGER NOT NULL,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        size INTEGER NOT NULL
      )
    `;

    const createIndexes = [
      `CREATE INDEX IF NOT EXISTS idx_cache_key ON ${this.cacheTableName}(key)`,
      `CREATE INDEX IF NOT EXISTS idx_cache_ttl ON ${this.cacheTableName}(ttl)`,
      `CREATE INDEX IF NOT EXISTS idx_cache_tags ON ${this.cacheTableName}(tags)`,
      `CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON ${this.cacheTableName}(last_accessed_at)`,
    ];

    try {
      await NativeModule.executeSql(createTableQuery, []);
      for (const indexQuery of createIndexes) {
        await NativeModule.executeSql(indexQuery, []);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to create cache table:', error);
      }
      throw error;
    }
  }

  /**
   * Generate cache key from URL and method
   */
  private generateCacheKey(url: string, method: string = 'GET'): string {
    // Normalize URL (remove query params for GET requests if needed)
    const normalizedUrl = method === 'GET' ? url.split('?')[0] : url;
    return `${method}:${normalizedUrl}`;
  }

  /**
   * Get cache entry by key
   */
  async get(key: string): Promise<CacheResult> {
    if (!this.config.enabled || !this.isInitialized) {
      return { hit: false };
    }

    try {
      const cacheKey = key.includes(':') ? key : this.generateCacheKey(key);
      const now = Date.now();

      const query = `
        SELECT * FROM ${this.cacheTableName}
        WHERE key = ?
      `;

      const results = await NativeModule.executeSql(query, [cacheKey]);

      if (!results || results.length === 0) {
        return { hit: false };
      }

      const entry: CacheEntry = this.parseCacheEntry(results[0]);
      
      // Check if expired
      if (entry.ttl < now) {
        // Expired - delete and return miss
        await this.delete(cacheKey);
        return { hit: false };
      }

      // Update last accessed time
      await this.updateLastAccessed(cacheKey, now);

      // Parse cached value
      const data = JSON.parse(entry.value);
      const remainingTtl = entry.ttl - now;

      return {
        hit: true,
        data,
        stale: false,
        ttl: remainingTtl,
      };
      } catch (error) {
        if (__DEV__) {
          console.error('Cache get error:', error);
        }
        return { hit: false };
    }
  }

  /**
   * Set cache entry
   */
  async set(
    key: string,
    value: any,
    options?: {
      ttl?: number;
      tags?: string[];
    }
  ): Promise<void> {
    if (!this.config.enabled || !this.isInitialized) {
      return;
    }

    try {
      const cacheKey = key.includes(':') ? key : this.generateCacheKey(key);
      const now = Date.now();
      const ttl = (options?.ttl ?? this.config.defaultTtl!) * 1000 + now;
      const valueString = JSON.stringify(value);
      // Calculate size: approximate UTF-8 size (most chars are 1 byte, some are 2-4)
      // Using length * 1.5 as approximation for mixed content
      const size = Math.ceil(valueString.length * 1.5);
      const tags = options?.tags ? options.tags.join(',') : null;

      // Check cache size and evict if needed
      await this.evictIfNeeded(size);

      const entry: Omit<CacheEntry, 'id' | 'createdAt' | 'updatedAt'> = {
        key: cacheKey,
        value: valueString,
        ttl,
        tags: tags || undefined,
        lastAccessedAt: now,
        size,
      };

      const id = generateRequestId();

      const query = `
        INSERT OR REPLACE INTO ${this.cacheTableName}
        (id, key, value, ttl, tags, created_at, updated_at, last_accessed_at, size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await NativeModule.executeSql(query, [
        id,
        entry.key,
        entry.value,
        entry.ttl,
        entry.tags || null,
        now,
        now,
        entry.lastAccessedAt,
        entry.size,
      ]);
    } catch (error) {
      if (__DEV__) {
        console.error('Cache set error:', error);
      }
      // Don't throw - cache failures shouldn't break the app
    }
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      const cacheKey = key.includes(':') ? key : this.generateCacheKey(key);
      const query = `DELETE FROM ${this.cacheTableName} WHERE key = ?`;
      await NativeModule.executeSql(query, [cacheKey]);
    } catch (error) {
      if (__DEV__) {
        console.error('Cache delete error:', error);
      }
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Delete entries that have any of the specified tags
      const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
      const tagParams = tags.map(tag => `%${tag}%`);

      const query = `DELETE FROM ${this.cacheTableName} WHERE ${tagConditions}`;
      await NativeModule.executeSql(query, tagParams);
    } catch (error) {
      if (__DEV__) {
        console.error('Cache invalidate by tags error:', error);
      }
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      const query = `DELETE FROM ${this.cacheTableName}`;
      await NativeModule.executeSql(query, []);
    } catch (error) {
      if (__DEV__) {
        console.error('Cache clear error:', error);
      }
    }
  }

  /**
   * Get cache size
   */
  async getSize(): Promise<number> {
    if (!this.isInitialized) {
      return 0;
    }

    try {
      const query = `SELECT SUM(size) as total_size FROM ${this.cacheTableName}`;
      const results = await NativeModule.executeSql(query, []);
      return results?.[0]?.total_size || 0;
    } catch (error) {
      if (__DEV__) {
        console.error('Cache get size error:', error);
      }
      return 0;
    }
  }

  /**
   * Evict expired entries
   */
  async evictExpired(): Promise<number> {
    if (!this.isInitialized) {
      return 0;
    }

    try {
      const now = Date.now();
      const query = `DELETE FROM ${this.cacheTableName} WHERE ttl < ?`;
      const result = await NativeModule.executeSql(query, [now]);
      return result?.changes || 0;
    } catch (error) {
      if (__DEV__) {
        console.error('Cache evict expired error:', error);
      }
      return 0;
    }
  }

  /**
   * Evict entries if cache size exceeds limit (LRU)
   */
  private async evictIfNeeded(newEntrySize: number): Promise<void> {
    const currentSize = await this.getSize();
    const maxSize = this.config.maxSize!;

    if (currentSize + newEntrySize <= maxSize) {
      return;
    }

    // Evict expired entries first
    await this.evictExpired();

    // If still over limit, evict least recently used
    const remainingSize = await this.getSize();
    if (remainingSize + newEntrySize > maxSize) {
      const toEvict = remainingSize + newEntrySize - maxSize;
      await this.evictLRU(toEvict);
    }
  }

  /**
   * Evict least recently used entries
   */
  private async evictLRU(targetSize: number): Promise<void> {
    try {
      // Get entries sorted by last accessed, oldest first
      const query = `
        SELECT id, size FROM ${this.cacheTableName}
        ORDER BY last_accessed_at ASC
      `;
      const results = await NativeModule.executeSql(query, []);

      let evictedSize = 0;
      const idsToDelete: string[] = [];

      for (const row of results || []) {
        if (evictedSize >= targetSize) {
          break;
        }
        idsToDelete.push(row.id);
        evictedSize += row.size || 0;
      }

      if (idsToDelete.length > 0) {
        const placeholders = idsToDelete.map(() => '?').join(',');
        const deleteQuery = `DELETE FROM ${this.cacheTableName} WHERE id IN (${placeholders})`;
        await NativeModule.executeSql(deleteQuery, idsToDelete);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Cache evict LRU error:', error);
      }
    }
  }

  /**
   * Update last accessed time
   */
  private async updateLastAccessed(key: string, timestamp: number): Promise<void> {
    try {
      const query = `
        UPDATE ${this.cacheTableName}
        SET last_accessed_at = ?
        WHERE key = ?
      `;
      await NativeModule.executeSql(query, [timestamp, key]);
    } catch (error) {
      // Non-critical error, don't throw
      if (__DEV__) {
        console.warn('Failed to update last accessed:', error);
      }
    }
  }

  /**
   * Parse cache entry from database row
   */
  private parseCacheEntry(row: any): CacheEntry {
    return {
      id: row.id,
      key: row.key,
      value: row.value,
      ttl: row.ttl,
      tags: row.tags,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
      size: row.size,
    };
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled === true && this.isInitialized;
  }

  /**
   * Get cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }
}

export default CacheManager;

