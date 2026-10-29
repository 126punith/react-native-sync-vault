package com.syncvault.core

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Process-wide engine. Independent of React: the Turbo Module is a thin adapter over it and
 * SyncWorker drives it directly when the app is in the background or was killed.
 */
class SyncVaultCore private constructor(context: Context) {
    private val appContext = context.applicationContext
    private val dbDispatcher = Executors.newSingleThreadExecutor { r -> Thread(r, "SyncVault-DB") }.asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val crypto = PayloadCrypto()
    private val database = OutboxDatabase.open(appContext)
    private val payloadDir = File(appContext.noBackupFilesDir, "sync_vault/payloads")
    private val repo by lazy { OutboxRepository(database.writableDatabase, crypto, payloadDir) }
    private val cacheStore by lazy { CacheStore(database.writableDatabase) }
    private val http = HttpExecutor()
    private val drainMutex = Mutex()
    private val random = SecureRandom()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val wakeRunnable = Runnable { requestDrain("timer") }

    @Volatile private var drainRequested = false
    @Volatile private var configCache: VaultConfig? = null
    @Volatile private var authHeadersCache: Map<String, String>? = null
    @Volatile var eventSink: VaultEventSink? = null
    @Volatile var hostInForeground: Boolean = false

    private val networkMonitor = NetworkMonitor(appContext) { state, cameOnline ->
        eventSink?.onNetworkChange(state)
        if (cameOnline) requestDrain("network")
    }

    init {
        networkMonitor.start()
        scope.launch {
            // A fresh process owns no in-flight work: anything still inflight was orphaned by a crash or kill.
            db { repo.recoverExpiredLeases(Long.MAX_VALUE, now()) }
            drain("startup")
        }
    }

    private suspend fun <T> db(block: () -> T): T = withContext(dbDispatcher) { block() }

    private fun now() = System.currentTimeMillis()

    private fun kvGet(key: String): String? =
        database.writableDatabase.rawQuery("SELECT value FROM kv WHERE key = ?", arrayOf(key)).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private fun kvSet(key: String, value: String) {
        database.writableDatabase.execSQL("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", arrayOf<Any>(key, value))
    }

    suspend fun config(): VaultConfig = configCache ?: db { VaultConfig.fromJson(kvGet("config")) }.also {
        configCache = it
        http.configure(it.requestTimeoutMs)
    }

    fun currentConfig(): VaultConfig = configCache ?: VaultConfig()

    private suspend fun authHeaders(): Map<String, String> = authHeadersCache ?: db {
        try {
            jsonToMap(crypto.decrypt(kvGet("auth_headers")))
        } catch (_: UndecryptableException) {
            emptyMap()
        }
    }.also { authHeadersCache = it }

    // region Public API

    suspend fun configure(config: VaultConfig) {
        db {
            kvSet("config", config.toJson())
            repo.purgeSucceeded(now() - SUCCEEDED_RETENTION_MS)
        }
        configCache = config
        http.configure(config.requestTimeoutMs)
        if (config.backgroundIntervalMinutes > 0) {
            BackgroundScheduler.schedulePeriodic(appContext, config.backgroundIntervalMinutes, config.wifiOnly, config.requiresCharging)
        }
        requestDrain("configure")
    }

    suspend fun enqueue(input: EnqueueInput): String {
        val cfg = config()
        val result = db { repo.enqueue(input, cfg, now()) }
        emit(RequestEventData(type = if (result.coalesced) "coalesced" else "enqueued", id = result.id, status = Status.PENDING))
        // Guarantees delivery after process death; the in-process drain handles the common case.
        BackgroundScheduler.enqueueDrain(appContext, cfg, expedited = !hostInForeground)
        requestDrain("enqueue")
        return result.id
    }

    suspend fun getRequests(statuses: List<String>, queueKey: String?, limit: Int, offset: Int): List<Pair<OutboxRow, String?>> = db {
        repo.query(statuses, queueKey, limit, offset).map { row ->
            row to try {
                repo.readBody(row)
            } catch (_: UndecryptableException) {
                null
            }
        }
    }

    suspend fun counts(): QueueCounts = db { repo.counts() }

    suspend fun retry(id: String): Boolean {
        val ok = db { repo.retry(id, now()) }
        if (ok) requestDrain("retry")
        return ok
    }

    suspend fun retryAllDeadLetters(): Int {
        val n = db { repo.retryAllDeadLetters(now()) }
        if (n > 0) requestDrain("retry")
        return n
    }

    suspend fun discard(id: String): Boolean {
        val ok = db { repo.delete(id) }
        if (ok) emit(RequestEventData(type = "discarded", id = id))
        return ok
    }

    suspend fun resolveConflict(id: String, payload: String?, version: String?): Boolean {
        val cfg = config()
        val ok = db { repo.resolveConflict(id, payload, version, cfg, now()) }
        if (ok) {
            emit(RequestEventData(type = if (payload == null) "discarded" else "conflict_resolved", id = id, status = if (payload == null) null else Status.PENDING))
            requestDrain("conflict_resolved")
        }
        return ok
    }

    suspend fun purgeSucceeded(olderThanMs: Long): Int = db { repo.purgeSucceeded(now() - olderThanMs) }

    suspend fun setAuthHeaders(headers: Map<String, String>) {
        db {
            kvSet("auth_headers", crypto.encrypt(mapToJson(headers))!!)
            repo.clearAuthBlocked(now())
        }
        authHeadersCache = headers
        requestDrain("auth")
    }

    suspend fun hasLargePending(): Boolean = db { repo.hasLargePending() }

    fun network(): NetworkSnapshot = networkMonitor.refresh()

    fun power(): PowerSnapshot = PowerMonitor.snapshot(appContext)

    fun scheduleBackgroundDrain(intervalMinutes: Int, unmetered: Boolean, charging: Boolean) {
        BackgroundScheduler.schedulePeriodic(appContext, intervalMinutes, unmetered, charging)
    }

    fun cancelBackgroundDrain() {
        BackgroundScheduler.cancelPeriodic(appContext)
        BackgroundScheduler.cancelRetry(appContext)
    }

    suspend fun cacheGet(key: String) = db { cacheStore.get(key, now()) }
    suspend fun cacheSet(key: String, value: String, ttlMs: Long, tags: List<String>) = db { cacheStore.set(key, value, ttlMs, tags, now()) }
    suspend fun cacheDelete(key: String) = db { cacheStore.delete(key) }
    suspend fun cacheInvalidate(prefix: String?, tags: List<String>) = db { cacheStore.invalidate(prefix, tags) }
    suspend fun cacheClear() = db { cacheStore.clear() }
    suspend fun cacheStats() = db { cacheStore.stats() }
    suspend fun cacheEvict(maxBytes: Long) = db { cacheStore.evict(maxBytes, now()) }

    // endregion

    // region Drain

    fun requestDrain(reason: String) {
        scope.launch { drain(reason) }
    }

    /**
     * Single-flight drain. Concurrent callers set a flag instead of waiting, and the running
     * drain loops again, so no trigger is lost and requests are never processed twice in-process.
     * Leases protect against duplicates across process death.
     */
    suspend fun drain(reason: String) {
        drainRequested = true
        while (true) {
            if (!drainMutex.tryLock()) return
            try {
                while (drainRequested) {
                    drainRequested = false
                    drainOnce(reason)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Drain failed", e)
            } finally {
                drainMutex.unlock()
            }
            if (!drainRequested) break
        }
        scheduleNextWake()
    }

    private fun policyAllows(cfg: VaultConfig, net: NetworkSnapshot): Boolean {
        if (!net.isConnected) return false
        if (cfg.wifiOnly && net.isExpensive) return false
        if (cfg.requiresCharging || cfg.minBatteryLevel > 0) {
            val power = power()
            if (cfg.requiresCharging && !power.isCharging) return false
            if (cfg.minBatteryLevel > 0 && !power.isCharging && power.batteryLevel >= 0 && power.batteryLevel < cfg.minBatteryLevel) return false
        }
        return true
    }

    private suspend fun drainOnce(reason: String) {
        val cfg = config()
        if (!policyAllows(cfg, networkMonitor.refresh())) return
        db { repo.recoverExpiredLeases(now(), now()) }
        emit(RequestEventData(type = "drain_started", error = reason))
        while (true) {
            val batch = db { repo.claimBatch(now(), cfg.maxConcurrency.coerceAtLeast(1), cfg.effectiveLeaseMs) }
            if (batch.isEmpty()) break
            coroutineScope {
                batch.map { row -> async(Dispatchers.IO) { process(row, cfg) } }.awaitAll()
            }
            if (!policyAllows(cfg, networkMonitor.current)) break
        }
        emit(RequestEventData(type = "drain_finished"))
    }

    private suspend fun process(row: OutboxRow, cfg: VaultConfig) {
        emit(RequestEventData(type = "attempt", id = row.id, status = Status.INFLIGHT, attempt = row.attempt))
        val body = try {
            if (row.payloadRef == null) db { repo.readBody(row) } else null
        } catch (e: UndecryptableException) {
            db { repo.markDeadLetter(row.id, 0, e.message, null, now()) }
            emit(RequestEventData(type = "dead_lettered", id = row.id, status = Status.DEAD_LETTER, attempt = row.attempt, error = e.message))
            return
        }
        val headers = LinkedHashMap(row.headers)
        headers.putAll(authHeaders())
        headers["Idempotency-Key"] = row.idempotencyKey
        row.ifMatch?.let { headers["If-Match"] = it }
        row.contentType?.let { headers["Content-Type"] = it }

        val result = http.execute(
            OutboundRequest(
                method = row.method,
                url = HttpExecutor.buildUrl(cfg.baseUrl, row.url, row.queryParams),
                headers = headers,
                body = body,
                bodyFile = row.payloadRef?.let { File(it) },
                contentType = row.contentType,
            )
        )
        val now = now()

        if (result.networkError != null) {
            if (!networkMonitor.refresh().isConnected) {
                // Lost connectivity mid-flight: do not burn an attempt; the network callback resumes.
                db { repo.markRetry(row.id, now, 0, result.networkError, now, refundAttempt = true) }
                emit(RequestEventData(type = "retry_scheduled", id = row.id, status = Status.PENDING, attempt = row.attempt - 1, error = result.networkError, nextAttemptAt = now))
            } else {
                retryOrDeadLetter(row, cfg, 0, result.networkError, null, null, now)
            }
            return
        }

        when (RetryPolicy.classify(result.status)) {
            RetryPolicy.Outcome.SUCCESS -> {
                db { repo.markSucceeded(row.id, result.status, result.body, result.headers["etag"], now) }
                emit(RequestEventData(type = "succeeded", id = row.id, status = Status.SUCCEEDED, attempt = row.attempt, httpStatus = result.status))
            }
            RetryPolicy.Outcome.CONFLICT -> handleConflict(row, result, now)
            RetryPolicy.Outcome.AUTH -> {
                db { repo.markAuthBlocked(row.id, result.status, now) }
                authHeadersCache = null
                emit(RequestEventData(type = "auth_blocked", id = row.id, status = Status.PENDING, attempt = row.attempt, httpStatus = result.status))
                eventSink?.onAuthHeadersNeeded(UuidV7.generate(now), row.id, result.status)
            }
            RetryPolicy.Outcome.RETRYABLE -> retryOrDeadLetter(
                row, cfg, result.status, "HTTP ${result.status}", result.body,
                RetryPolicy.parseRetryAfterMs(result.headers["retry-after"], now), now,
            )
            RetryPolicy.Outcome.PERMANENT -> {
                db { repo.markDeadLetter(row.id, result.status, "HTTP ${result.status}", result.body, now) }
                emit(RequestEventData(type = "dead_lettered", id = row.id, status = Status.DEAD_LETTER, attempt = row.attempt, httpStatus = result.status, error = "HTTP ${result.status}"))
            }
        }
    }

    private suspend fun retryOrDeadLetter(
        row: OutboxRow, cfg: VaultConfig, httpStatus: Int, error: String,
        responseBody: String?, retryAfterMs: Long?, now: Long,
    ) {
        if (row.attempt >= row.maxAttempts) {
            val message = "max attempts reached ($error)"
            db { repo.markDeadLetter(row.id, httpStatus, message, responseBody, now) }
            emit(RequestEventData(type = "dead_lettered", id = row.id, status = Status.DEAD_LETTER, attempt = row.attempt, httpStatus = httpStatus, error = message))
            return
        }
        val next = RetryPolicy.nextAttemptAt(
            now, row.attempt, cfg.retryBaseDelayMs.toLong(), cfg.retryMaxDelayMs.toLong(), retryAfterMs, random.nextDouble(),
        )
        db { repo.markRetry(row.id, next, httpStatus, error, now, refundAttempt = false) }
        emit(RequestEventData(type = "retry_scheduled", id = row.id, status = Status.PENDING, attempt = row.attempt, httpStatus = httpStatus, error = error, nextAttemptAt = next))
    }

    private suspend fun handleConflict(row: OutboxRow, result: HttpResult, now: Long) {
        val version = result.headers["etag"] ?: extractVersion(result.body)
        when {
            row.conflictStrategy == "server_wins" -> {
                db { repo.delete(row.id, allowInflight = true) }
                emit(RequestEventData(type = "discarded", id = row.id, httpStatus = result.status, error = "server_wins"))
            }
            row.conflictStrategy == "client_wins" && version != null && row.attempt < row.maxAttempts -> {
                db { repo.requeueWithVersion(row.id, version, now) }
                emit(RequestEventData(type = "conflict_resolved", id = row.id, status = Status.PENDING, attempt = row.attempt, httpStatus = result.status, error = "client_wins"))
            }
            else -> {
                db { repo.markConflict(row.id, result.status, result.body, version, now) }
                emit(RequestEventData(type = "conflict", id = row.id, status = Status.CONFLICT, attempt = row.attempt, httpStatus = result.status))
                val localBody = try {
                    db { repo.readBody(row) }
                } catch (_: UndecryptableException) {
                    null
                }
                eventSink?.onConflict(ConflictEventData(row.id, row.method, row.url, localBody, result.body, version, result.status))
            }
        }
    }

    private fun extractVersion(body: String?): String? {
        if (body.isNullOrEmpty()) return null
        return try {
            val o = JSONObject(body)
            listOf("version", "_version", "etag").firstNotNullOfOrNull { k -> if (o.has(k) && !o.isNull(k)) o.get(k).toString() else null }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * After a drain: arm an in-process timer for the next backed-off request, and mirror it in
     * WorkManager so the retry still happens if the process dies.
     */
    private suspend fun scheduleNextWake() {
        val cfg = config()
        mainHandler.removeCallbacks(wakeRunnable)
        val next = db { repo.nextWakeAt() }
        if (next == null) {
            BackgroundScheduler.cancelRetry(appContext)
            return
        }
        if (!policyAllows(cfg, networkMonitor.current)) {
            // Constraint-based work runs as soon as the network (and charging policy) allows.
            BackgroundScheduler.enqueueDrain(appContext, cfg, expedited = false)
            return
        }
        val delay = (next - now()).coerceAtLeast(MIN_WAKE_DELAY_MS)
        mainHandler.postDelayed(wakeRunnable, delay)
        BackgroundScheduler.scheduleRetry(appContext, cfg, delay)
    }

    private fun emit(event: RequestEventData) {
        try {
            eventSink?.onRequestEvent(event)
        } catch (e: Exception) {
            Log.w(TAG, "Event delivery failed", e)
        }
    }

    // endregion

    companion object {
        private const val TAG = "SyncVault"
        private const val SUCCEEDED_RETENTION_MS = 7L * 24 * 60 * 60 * 1000
        private const val MIN_WAKE_DELAY_MS = 250L

        @Volatile private var instance: SyncVaultCore? = null

        fun getInstance(context: Context): SyncVaultCore =
            instance ?: synchronized(this) {
                instance ?: SyncVaultCore(context).also { instance = it }
            }
    }
}
