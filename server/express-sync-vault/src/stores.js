'use strict';

/**
 * Idempotency record stores. A store needs four async operations:
 *   get(key) -> record | null
 *   setIfAbsent(key, record, ttlMs) -> boolean   (atomic; the idempotency lock)
 *   set(key, record, ttlMs)
 *   delete(key)
 */

class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  _live(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async get(key) {
    const entry = this._live(key);
    return entry ? entry.value : null;
  }

  async setIfAbsent(key, value, ttlMs) {
    if (this._live(key)) return false;
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async set(key, value, ttlMs) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key) {
    this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Works with ioredis and node-redis v4+ clients. Records are JSON strings with a PX expiry;
 * setIfAbsent uses SET NX so concurrent duplicates across server instances are serialized.
 */
class RedisStore {
  constructor(client, { prefix = 'sync-vault:idem:' } = {}) {
    if (!client) throw new Error('RedisStore requires a redis client');
    this.client = client;
    this.prefix = prefix;
    this.nodeRedis = typeof client.isOpen === 'boolean';
  }

  async get(key) {
    const raw = await this.client.get(this.prefix + key);
    return raw ? JSON.parse(raw) : null;
  }

  async setIfAbsent(key, value, ttlMs) {
    const k = this.prefix + key;
    const v = JSON.stringify(value);
    const ms = Math.max(1, Math.round(ttlMs));
    const result = this.nodeRedis
      ? await this.client.set(k, v, { PX: ms, NX: true })
      : await this.client.set(k, v, 'PX', ms, 'NX');
    return result === 'OK';
  }

  async set(key, value, ttlMs) {
    const k = this.prefix + key;
    const v = JSON.stringify(value);
    const ms = Math.max(1, Math.round(ttlMs));
    if (this.nodeRedis) await this.client.set(k, v, { PX: ms });
    else await this.client.set(k, v, 'PX', ms);
  }

  async delete(key) {
    await this.client.del(this.prefix + key);
  }
}

module.exports = { MemoryStore, RedisStore };
