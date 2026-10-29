package com.syncvault.core

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.io.File

/**
 * All outbox state transitions. Every method runs on the single DB dispatcher owned by
 * SyncVaultCore, so each transition is serialized and wrapped in its own transaction.
 */
class OutboxRepository(
    private val db: SQLiteDatabase,
    private val crypto: PayloadCrypto,
    private val payloadDir: File,
) {
    data class EnqueueResult(val id: String, val coalesced: Boolean)

    private inline fun <T> tx(block: () -> T): T {
        db.beginTransaction()
        try {
            val result = block()
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    fun enqueue(input: EnqueueInput, config: VaultConfig, now: Long): EnqueueResult = tx {
        val encrypt = config.encryptPayloads
        val headersJson = mapToJson(input.headers)
        val storedHeaders = if (encrypt) crypto.encrypt(headersJson)!! else headersJson
        val maxAttempts = if (input.maxAttempts > 0) input.maxAttempts else config.defaultMaxAttempts

        if (input.dedupeKey != null) {
            // Only the newest unfinished row may absorb the change; anything older is delivered first.
            val existing = db.rawQuery(
                "SELECT id, payload_ref, (attempt > 0 OR last_http_status != 0 OR last_error IS NOT NULL), status " +
                    "FROM outbox WHERE dedupe_key = ? AND status IN ('pending', 'inflight', 'conflict') ORDER BY seq DESC LIMIT 1",
                arrayOf(input.dedupeKey),
            ).use { c ->
                if (c.moveToFirst() && c.getString(3) == Status.PENDING) Triple(c.getString(0), c.getStringOrNull(1), c.getInt(2) == 1) else null
            }
            if (existing != null) {
                // Refunded attempts (offline, 401) may still have reached the server, so "ever sent"
                // is derived from the last result rather than the attempt counter.
                val (id, oldRef, everSent) = existing
                oldRef?.let { File(it).delete() }
                val (body, payloadRef) = storeBody(id, input.body, config)
                val values = ContentValues().apply {
                    put("method", input.method.uppercase())
                    put("url", input.url)
                    put("headers", storedHeaders)
                    put("body", body)
                    put("payload_ref", payloadRef)
                    put("content_type", input.contentType)
                    put("if_match", input.ifMatch)
                    put("priority", input.priority)
                    put("max_attempts", maxAttempts)
                    put("conflict_strategy", input.conflictStrategy)
                    put("metadata", input.metadata)
                    put("attempt", 0)
                    put("next_attempt_at", 0)
                    put("updated_at", now)
                    // The server may already hold the old body under the old key; a new body needs a new key.
                    if (everSent) put("idempotency_key", input.idempotencyKey ?: UuidV7.generate(now))
                }
                db.update("outbox", values, "id = ?", arrayOf(id))
                return@tx EnqueueResult(id, true)
            }
        }

        val id = UuidV7.generate(now)
        val (body, payloadRef) = storeBody(id, input.body, config)
        val values = ContentValues().apply {
            put("id", id)
            put("idempotency_key", input.idempotencyKey ?: id)
            put("queue_key", input.queueKey)
            put("dedupe_key", input.dedupeKey)
            put("method", input.method.uppercase())
            put("url", input.url)
            put("headers", storedHeaders)
            put("body", body)
            put("payload_ref", payloadRef)
            put("content_type", input.contentType)
            put("if_match", input.ifMatch)
            put("status", Status.PENDING)
            put("priority", input.priority)
            put("attempt", 0)
            put("max_attempts", maxAttempts)
            put("next_attempt_at", 0)
            put("auth_blocked", 0)
            put("conflict_strategy", input.conflictStrategy)
            put("metadata", input.metadata)
            put("created_at", now)
            put("updated_at", now)
        }
        db.insertOrThrow("outbox", null, values)
        EnqueueResult(id, false)
    }

    /** Large bodies go to a file so background uploads can stream them. */
    private fun storeBody(id: String, body: String?, config: VaultConfig): Pair<String?, String?> {
        if (body == null) return null to null
        val bytes = body.toByteArray(Charsets.UTF_8)
        if (bytes.size > config.largePayloadThresholdBytes) {
            payloadDir.mkdirs()
            val file = File(payloadDir, "$id.body")
            file.writeBytes(bytes)
            return null to file.absolutePath
        }
        return (if (config.encryptPayloads) crypto.encrypt(body) else body) to null
    }

    /**
     * Returns rows whose lease expired before [leaseCutoff] to pending. An interrupted attempt
     * still counts, so rows that already used their whole budget are dead-lettered instead of
     * being sent again (this also stops a request that crashes the process from looping).
     */
    fun recoverExpiredLeases(leaseCutoff: Long, now: Long = System.currentTimeMillis()): Int {
        val expired = "status = 'inflight' AND (lease_until IS NULL OR lease_until < ?)"
        db.beginTransaction()
        try {
            val exhausted = ContentValues().apply {
                put("status", Status.DEAD_LETTER)
                putNull("lease_until")
                put("last_error", "interrupted during the last allowed attempt")
                put("completed_at", now)
                put("updated_at", now)
            }
            val dead = db.update("outbox", exhausted, "$expired AND attempt >= max_attempts", arrayOf(leaseCutoff.toString()))
            val values = ContentValues().apply {
                put("status", Status.PENDING)
                putNull("lease_until")
                put("updated_at", now)
            }
            val recovered = db.update("outbox", values, expired, arrayOf(leaseCutoff.toString()))
            db.setTransactionSuccessful()
            return dead + recovered
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Claims up to [limit] ready requests. Within a queue_key (and a dedupe_key) only the oldest
     * unfinished request is eligible, which gives strict FIFO per key and parallelism across keys.
     * Ordering dedupe_key rows stops a retried older body from overwriting a newer one.
     */
    fun claimBatch(now: Long, limit: Int, leaseMs: Long): List<OutboxRow> = tx {
        val rows = db.rawQuery(
            "SELECT o.* FROM outbox o WHERE $ELIGIBLE AND o.next_attempt_at <= ? ORDER BY o.priority DESC, o.seq ASC LIMIT ?",
            arrayOf(now.toString(), limit.toString()),
        ).use { c -> generateSequence { if (c.moveToNext()) readRow(c) else null }.toList() }

        rows.mapNotNull { row ->
            val values = ContentValues().apply {
                put("status", Status.INFLIGHT)
                put("attempt", row.attempt + 1)
                put("lease_until", now + leaseMs)
                put("updated_at", now)
            }
            val changed = db.update("outbox", values, "id = ? AND status = 'pending'", arrayOf(row.id))
            if (changed == 1) row.copy(status = Status.INFLIGHT, attempt = row.attempt + 1) else null
        }
    }

    fun markSucceeded(id: String, httpStatus: Int, response: String?, version: String?, now: Long) {
        val values = ContentValues().apply {
            put("status", Status.SUCCEEDED)
            putNull("lease_until")
            put("last_http_status", httpStatus)
            put("server_response", response?.take(MAX_STORED_RESPONSE))
            put("server_version", version)
            putNull("last_error")
            put("completed_at", now)
            put("updated_at", now)
        }
        db.update("outbox", values, "id = ?", arrayOf(id))
        deletePayloadFile(id)
    }

    fun markRetry(id: String, nextAttemptAt: Long, httpStatus: Int, error: String?, now: Long, refundAttempt: Boolean) {
        db.execSQL(
            "UPDATE outbox SET status = 'pending', lease_until = NULL, next_attempt_at = ?, last_http_status = ?, " +
                "last_error = ?, updated_at = ?, attempt = attempt - ? WHERE id = ?",
            arrayOf<Any?>(nextAttemptAt, httpStatus, error, now, if (refundAttempt) 1 else 0, id),
        )
    }

    fun markDeadLetter(id: String, httpStatus: Int, error: String?, response: String?, now: Long) {
        val values = ContentValues().apply {
            put("status", Status.DEAD_LETTER)
            putNull("lease_until")
            put("last_http_status", httpStatus)
            put("last_error", error)
            put("server_response", response?.take(MAX_STORED_RESPONSE))
            put("completed_at", now)
            put("updated_at", now)
        }
        db.update("outbox", values, "id = ?", arrayOf(id))
    }

    fun markConflict(id: String, httpStatus: Int, serverBody: String?, version: String?, now: Long) {
        val values = ContentValues().apply {
            put("status", Status.CONFLICT)
            putNull("lease_until")
            put("last_http_status", httpStatus)
            put("server_response", serverBody?.take(MAX_STORED_RESPONSE))
            put("server_version", version)
            put("updated_at", now)
        }
        db.update("outbox", values, "id = ?", arrayOf(id))
    }

    /** client_wins: retry immediately against the server's current version. */
    fun requeueWithVersion(id: String, version: String, now: Long) {
        val values = ContentValues().apply {
            put("status", Status.PENDING)
            putNull("lease_until")
            put("if_match", version)
            put("next_attempt_at", 0)
            put("updated_at", now)
        }
        db.update("outbox", values, "id = ?", arrayOf(id))
    }

    /** 401: park the request without burning an attempt until fresh auth headers arrive. */
    fun markAuthBlocked(id: String, httpStatus: Int, now: Long) {
        db.execSQL(
            "UPDATE outbox SET status = 'pending', lease_until = NULL, auth_blocked = 1, last_http_status = ?, " +
                "last_error = 'unauthorized', attempt = MAX(attempt - 1, 0), updated_at = ? WHERE id = ?",
            arrayOf<Any?>(httpStatus, now, id),
        )
    }

    fun clearAuthBlocked(now: Long): Int {
        val values = ContentValues().apply {
            put("auth_blocked", 0)
            put("next_attempt_at", 0)
            put("updated_at", now)
        }
        return db.update("outbox", values, "auth_blocked = 1", null)
    }

    fun resolveConflict(id: String, payload: String?, version: String?, config: VaultConfig, now: Long): Boolean = tx {
        if (payload == null) {
            return@tx delete(id)
        }
        val values = ContentValues().apply {
            put("status", Status.PENDING)
            put("body", if (config.encryptPayloads) crypto.encrypt(payload) else payload)
            putNull("payload_ref")
            put("if_match", version)
            put("attempt", 0)
            put("next_attempt_at", 0)
            put("idempotency_key", UuidV7.generate(now))
            put("updated_at", now)
        }
        deletePayloadFile(id)
        db.update("outbox", values, "id = ? AND status = 'conflict'", arrayOf(id)) == 1
    }

    fun retry(id: String, now: Long): Boolean {
        val values = ContentValues().apply {
            put("status", Status.PENDING)
            put("attempt", 0)
            put("next_attempt_at", 0)
            put("auth_blocked", 0)
            put("completed_at", 0)
            put("updated_at", now)
        }
        return db.update("outbox", values, "id = ? AND status IN ('dead_letter', 'conflict')", arrayOf(id)) == 1
    }

    fun retryAllDeadLetters(now: Long): Int {
        val values = ContentValues().apply {
            put("status", Status.PENDING)
            put("attempt", 0)
            put("next_attempt_at", 0)
            put("completed_at", 0)
            put("updated_at", now)
        }
        return db.update("outbox", values, "status = 'dead_letter'", null)
    }

    fun delete(id: String, allowInflight: Boolean = false): Boolean {
        val where = if (allowInflight) "id = ?" else "id = ? AND status != 'inflight'"
        val deleted = db.delete("outbox", where, arrayOf(id)) == 1
        if (deleted) deletePayloadFile(id)
        return deleted
    }

    fun purgeSucceeded(olderThan: Long): Int =
        db.delete("outbox", "status = 'succeeded' AND completed_at < ?", arrayOf(olderThan.toString()))

    fun get(id: String): OutboxRow? =
        db.rawQuery("SELECT * FROM outbox WHERE id = ?", arrayOf(id)).use { c -> if (c.moveToFirst()) readRow(c) else null }

    fun query(statuses: List<String>, queueKey: String?, limit: Int, offset: Int): List<OutboxRow> {
        val where = StringBuilder("1 = 1")
        val args = ArrayList<String>()
        if (statuses.isNotEmpty()) {
            where.append(" AND status IN (").append(statuses.joinToString(",") { "?" }).append(")")
            args.addAll(statuses)
        }
        if (queueKey != null) {
            where.append(" AND queue_key = ?")
            args.add(queueKey)
        }
        args.add(limit.coerceAtLeast(1).toString())
        args.add(offset.coerceAtLeast(0).toString())
        return db.rawQuery("SELECT * FROM outbox WHERE $where ORDER BY priority DESC, seq ASC LIMIT ? OFFSET ?", args.toTypedArray())
            .use { c -> generateSequence { if (c.moveToNext()) readRow(c) else null }.toList() }
    }

    fun counts(): QueueCounts = db.rawQuery(
        """
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status = 'inflight' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status = 'pending' AND auth_blocked = 1 THEN 1 ELSE 0 END)
        FROM outbox
        """.trimIndent(),
        null,
    ).use { c ->
        c.moveToFirst()
        QueueCounts(c.getInt(0), c.getInt(1), c.getInt(2), c.getInt(3), c.getInt(4), c.getInt(5))
    }

    /**
     * Earliest time an eligible request becomes ready, or null when nothing is waiting.
     * Requests blocked behind their queue_key head are excluded so they cannot cause busy wake-ups.
     */
    fun nextWakeAt(): Long? = db.rawQuery(
        "SELECT MIN(o.next_attempt_at) FROM outbox o WHERE $ELIGIBLE",
        null,
    ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

    fun hasLargePending(): Boolean = db.rawQuery(
        "SELECT 1 FROM outbox WHERE status = 'pending' AND payload_ref IS NOT NULL LIMIT 1",
        null,
    ).use { it.moveToFirst() }

    fun readBody(row: OutboxRow): String? = crypto.decrypt(row.body)

    private fun deletePayloadFile(id: String) {
        File(payloadDir, "$id.body").delete()
    }

    private fun readRow(c: Cursor): OutboxRow = OutboxRow(
        seq = c.getLong(c.getColumnIndexOrThrow("seq")),
        id = c.getString(c.getColumnIndexOrThrow("id")),
        idempotencyKey = c.getString(c.getColumnIndexOrThrow("idempotency_key")),
        queueKey = c.getStringOrNull(c.getColumnIndexOrThrow("queue_key")),
        dedupeKey = c.getStringOrNull(c.getColumnIndexOrThrow("dedupe_key")),
        method = c.getString(c.getColumnIndexOrThrow("method")),
        url = c.getString(c.getColumnIndexOrThrow("url")),
        queryParams = c.getStringOrNull(c.getColumnIndexOrThrow("query_params")),
        headers = jsonToMap(decryptOrNull(c.getStringOrNull(c.getColumnIndexOrThrow("headers")))),
        body = c.getStringOrNull(c.getColumnIndexOrThrow("body")),
        payloadRef = c.getStringOrNull(c.getColumnIndexOrThrow("payload_ref")),
        contentType = c.getStringOrNull(c.getColumnIndexOrThrow("content_type")),
        ifMatch = c.getStringOrNull(c.getColumnIndexOrThrow("if_match")),
        status = c.getString(c.getColumnIndexOrThrow("status")),
        priority = c.getInt(c.getColumnIndexOrThrow("priority")),
        attempt = c.getInt(c.getColumnIndexOrThrow("attempt")),
        maxAttempts = c.getInt(c.getColumnIndexOrThrow("max_attempts")),
        nextAttemptAt = c.getLong(c.getColumnIndexOrThrow("next_attempt_at")),
        authBlocked = c.getInt(c.getColumnIndexOrThrow("auth_blocked")) == 1,
        conflictStrategy = c.getString(c.getColumnIndexOrThrow("conflict_strategy")),
        lastError = c.getStringOrNull(c.getColumnIndexOrThrow("last_error")),
        lastHttpStatus = c.getInt(c.getColumnIndexOrThrow("last_http_status")),
        serverResponse = c.getStringOrNull(c.getColumnIndexOrThrow("server_response")),
        serverVersion = c.getStringOrNull(c.getColumnIndexOrThrow("server_version")),
        metadata = c.getStringOrNull(c.getColumnIndexOrThrow("metadata")),
        createdAt = c.getLong(c.getColumnIndexOrThrow("created_at")),
        updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at")),
        completedAt = c.getLong(c.getColumnIndexOrThrow("completed_at")),
    )

    /** Header decryption failures surface later as a dead letter instead of crashing reads. */
    private fun decryptOrNull(value: String?): String? = try {
        crypto.decrypt(value)
    } catch (_: UndecryptableException) {
        null
    }

    companion object {
        const val MAX_STORED_RESPONSE = 64 * 1024

        private const val ELIGIBLE = """o.status = 'pending' AND o.auth_blocked = 0
            AND (o.queue_key IS NULL OR NOT EXISTS (
              SELECT 1 FROM outbox p WHERE p.queue_key = o.queue_key AND p.seq < o.seq
                AND p.status IN ('pending', 'inflight', 'conflict')))
            AND (o.dedupe_key IS NULL OR NOT EXISTS (
              SELECT 1 FROM outbox p WHERE p.dedupe_key = o.dedupe_key AND p.seq < o.seq
                AND p.status IN ('pending', 'inflight', 'conflict')))"""
    }
}

internal fun Cursor.getStringOrNull(index: Int): String? = if (isNull(index)) null else getString(index)
