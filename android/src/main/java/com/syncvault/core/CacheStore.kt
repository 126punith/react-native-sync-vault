package com.syncvault.core

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase

/** Response cache with TTL, tag/prefix invalidation and LRU eviction. Runs on the DB dispatcher. */
class CacheStore(private val db: SQLiteDatabase) {

    fun get(key: String, now: Long): CacheRow? {
        val row = db.rawQuery(
            "SELECT key, value, tags, expires_at, created_at FROM cache WHERE key = ?",
            arrayOf(key),
        ).use { c ->
            if (!c.moveToFirst()) return null
            CacheRow(c.getString(0), c.getString(1), splitTags(c.getString(2)), c.getLong(3), c.getLong(4))
        }
        if (row.expiresAt in 1 until now) {
            db.delete("cache", "key = ?", arrayOf(key))
            return null
        }
        db.execSQL("UPDATE cache SET last_accessed_at = ? WHERE key = ?", arrayOf<Any>(now, key))
        return row
    }

    fun set(key: String, value: String, ttlMs: Long, tags: List<String>, now: Long) {
        val values = ContentValues().apply {
            put("key", key)
            put("value", value)
            put("tags", joinTags(tags))
            put("expires_at", if (ttlMs > 0) now + ttlMs else 0L)
            put("size", value.toByteArray(Charsets.UTF_8).size)
            put("created_at", now)
            put("last_accessed_at", now)
        }
        db.insertWithOnConflict("cache", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun delete(key: String) {
        db.delete("cache", "key = ?", arrayOf(key))
    }

    fun invalidate(prefix: String?, tags: List<String>): Int {
        var removed = 0
        if (prefix != null) {
            removed += db.delete("cache", "key LIKE ? ESCAPE '\\'", arrayOf(escapeLike(prefix) + "%"))
        }
        for (tag in tags) {
            removed += db.delete("cache", "tags LIKE ? ESCAPE '\\'", arrayOf("%," + escapeLike(tag) + ",%"))
        }
        return removed
    }

    fun clear() {
        db.delete("cache", null, null)
    }

    fun stats(): Pair<Int, Long> = db.rawQuery("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM cache", null).use { c ->
        c.moveToFirst()
        c.getInt(0) to c.getLong(1)
    }

    fun evict(maxBytes: Long, now: Long): Int {
        var removed = db.delete("cache", "expires_at > 0 AND expires_at < ?", arrayOf(now.toString()))
        var total = stats().second
        if (total <= maxBytes) return removed
        db.rawQuery("SELECT key, size FROM cache ORDER BY last_accessed_at ASC", null).use { c ->
            while (total > maxBytes && c.moveToNext()) {
                db.delete("cache", "key = ?", arrayOf(c.getString(0)))
                total -= c.getLong(1)
                removed++
            }
        }
        return removed
    }

    private fun joinTags(tags: List<String>): String = if (tags.isEmpty()) "" else tags.joinToString(",", prefix = ",", postfix = ",")

    private fun splitTags(stored: String): List<String> = stored.split(",").filter { it.isNotEmpty() }

    private fun escapeLike(s: String): String = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
}
