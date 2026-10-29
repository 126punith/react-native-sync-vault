package com.syncvault

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.syncvault.core.ConflictEventData
import com.syncvault.core.EnqueueInput
import com.syncvault.core.NetworkSnapshot
import com.syncvault.core.OutboxRow
import com.syncvault.core.RequestEventData
import com.syncvault.core.SyncVaultCore
import com.syncvault.core.UuidV7
import com.syncvault.core.VaultConfig
import com.syncvault.core.VaultEventSink
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Thin Turbo Module adapter over [SyncVaultCore]. */
class SyncVaultModule(reactContext: ReactApplicationContext) :
    NativeSyncVaultSpec(reactContext), LifecycleEventListener, VaultEventSink {

    private val core = SyncVaultCore.getInstance(reactContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    init {
        core.eventSink = this
        reactContext.addLifecycleEventListener(this)
    }

    override fun invalidate() {
        if (core.eventSink === this) core.eventSink = null
        reactApplicationContext.removeLifecycleEventListener(this)
        scope.cancel()
        super.invalidate()
    }

    private fun launch(promise: Promise, block: suspend () -> Any?) {
        scope.launch {
            try {
                promise.resolve(block())
            } catch (e: Exception) {
                promise.reject("SYNC_VAULT_ERROR", e.message, e)
            }
        }
    }

    // region Lifecycle

    override fun onHostResume() {
        core.hostInForeground = true
        core.requestDrain("foreground")
    }

    override fun onHostPause() {
        core.hostInForeground = false
    }

    override fun onHostDestroy() {
        core.hostInForeground = false
    }

    // endregion

    // region Spec

    override fun configure(config: ReadableMap, promise: Promise) = launch(promise) {
        val d = VaultConfig()
        core.configure(
            VaultConfig(
                baseUrl = config.str("baseUrl") ?: d.baseUrl,
                maxConcurrency = config.int("maxConcurrency", d.maxConcurrency),
                requestTimeoutMs = config.int("requestTimeoutMs", d.requestTimeoutMs),
                leaseMs = config.int("leaseMs", d.leaseMs),
                defaultMaxAttempts = config.int("defaultMaxAttempts", d.defaultMaxAttempts),
                retryBaseDelayMs = config.int("retryBaseDelayMs", d.retryBaseDelayMs),
                retryMaxDelayMs = config.int("retryMaxDelayMs", d.retryMaxDelayMs),
                encryptPayloads = config.bool("encryptPayloads", d.encryptPayloads),
                wifiOnly = config.bool("wifiOnly", d.wifiOnly),
                requiresCharging = config.bool("requiresCharging", d.requiresCharging),
                minBatteryLevel = if (config.hasKey("minBatteryLevel")) config.getDouble("minBatteryLevel") else d.minBatteryLevel,
                backgroundIntervalMinutes = config.int("backgroundIntervalMinutes", d.backgroundIntervalMinutes),
                largePayloadThresholdBytes = config.int("largePayloadThresholdBytes", d.largePayloadThresholdBytes),
                notificationTitle = config.str("notificationTitle") ?: d.notificationTitle,
            )
        )
        null
    }

    override fun enqueue(request: ReadableMap, promise: Promise) = launch(promise) {
        core.enqueue(
            EnqueueInput(
                method = request.str("method") ?: throw IllegalArgumentException("method is required"),
                url = request.str("url") ?: throw IllegalArgumentException("url is required"),
                headers = request.stringMap("headers"),
                body = request.str("body"),
                contentType = request.str("contentType"),
                idempotencyKey = request.str("idempotencyKey"),
                queueKey = request.str("queueKey"),
                dedupeKey = request.str("dedupeKey"),
                ifMatch = request.str("ifMatch"),
                priority = request.int("priority", 0),
                maxAttempts = request.int("maxAttempts", 0),
                conflictStrategy = request.str("conflictStrategy") ?: "manual",
                metadata = request.str("metadata"),
            )
        )
    }

    override fun getRequests(filter: ReadableMap, promise: Promise) = launch(promise) {
        val statuses = filter.getArray("statuses")?.strings() ?: emptyList()
        val rows = core.getRequests(statuses, filter.str("queueKey"), filter.int("limit", 50), filter.int("offset", 0))
        Arguments.createArray().apply { rows.forEach { (row, body) -> pushMap(row.toWritable(body)) } }
    }

    override fun getCounts(promise: Promise) = launch(promise) {
        val c = core.counts()
        Arguments.createMap().apply {
            putInt("pending", c.pending)
            putInt("inflight", c.inflight)
            putInt("conflict", c.conflict)
            putInt("deadLetter", c.deadLetter)
            putInt("succeeded", c.succeeded)
            putInt("authBlocked", c.authBlocked)
        }
    }

    override fun retry(id: String, promise: Promise) = launch(promise) { core.retry(id); null }

    override fun retryAllDeadLetters(promise: Promise) = launch(promise) { core.retryAllDeadLetters() }

    override fun discard(id: String, promise: Promise) = launch(promise) { core.discard(id); null }

    override fun resolveConflict(id: String, payload: String?, version: String?, promise: Promise) = launch(promise) {
        if (!core.resolveConflict(id, payload, version)) throw IllegalStateException("Request $id is not in conflict")
        null
    }

    override fun purgeSucceeded(olderThanMs: Double, promise: Promise) = launch(promise) { core.purgeSucceeded(olderThanMs.toLong()) }

    override fun drainNow() = core.requestDrain("manual")

    override fun scheduleBackgroundDrain(policy: ReadableMap) {
        core.scheduleBackgroundDrain(
            policy.int("intervalMinutes", 15),
            policy.bool("requiresUnmeteredNetwork", false),
            policy.bool("requiresCharging", false),
        )
    }

    override fun cancelBackgroundDrain() = core.cancelBackgroundDrain()

    override fun getNetworkState(): WritableMap = core.network().toWritable()

    override fun getPowerState(): WritableMap {
        val p = core.power()
        return Arguments.createMap().apply {
            putDouble("batteryLevel", p.batteryLevel)
            putBoolean("isCharging", p.isCharging)
            putBoolean("isLowPowerMode", p.isLowPowerMode)
        }
    }

    override fun generateId(): String = UuidV7.generate()

    override fun setAuthHeaders(headers: ReadableMap) {
        val map = headers.toStringMap()
        scope.launch { core.setAuthHeaders(map) }
    }

    override fun provideAuthHeaders(requestToken: String, headers: ReadableMap) = setAuthHeaders(headers)

    override fun cacheGet(key: String, promise: Promise) = launch(promise) {
        core.cacheGet(key)?.let { row ->
            Arguments.createMap().apply {
                putString("key", row.key)
                putString("value", row.value)
                putArray("tags", Arguments.fromList(row.tags))
                putDouble("expiresAt", row.expiresAt.toDouble())
                putDouble("createdAt", row.createdAt.toDouble())
            }
        }
    }

    override fun cacheSet(key: String, value: String, ttlMs: Double, tags: ReadableArray, promise: Promise) = launch(promise) {
        core.cacheSet(key, value, ttlMs.toLong(), tags.strings()); null
    }

    override fun cacheDelete(key: String, promise: Promise) = launch(promise) { core.cacheDelete(key); null }

    override fun cacheInvalidate(prefix: String?, tags: ReadableArray, promise: Promise) = launch(promise) {
        core.cacheInvalidate(prefix, tags.strings())
    }

    override fun cacheClear(promise: Promise) = launch(promise) { core.cacheClear(); null }

    override fun cacheStats(promise: Promise) = launch(promise) {
        val (entries, size) = core.cacheStats()
        Arguments.createMap().apply {
            putInt("entries", entries)
            putDouble("sizeBytes", size.toDouble())
        }
    }

    override fun cacheEvict(maxBytes: Double, promise: Promise) = launch(promise) { core.cacheEvict(maxBytes.toLong()) }

    // endregion

    // region VaultEventSink

    // The core starts draining at launch, so it may emit before React Native installs the emitter
    // callback (the generated emitOn* methods would throw). JS re-reads state when it subscribes.
    private inline fun whenAttached(emit: () -> Unit) {
        if (mEventEmitterCallback != null) emit()
    }

    override fun onRequestEvent(event: RequestEventData) = whenAttached {
        emitOnRequestEvent(Arguments.createMap().apply {
            putString("type", event.type)
            putString("id", event.id)
            putString("status", event.status)
            putInt("attempt", event.attempt)
            putInt("httpStatus", event.httpStatus)
            putString("error", event.error)
            putDouble("nextAttemptAt", event.nextAttemptAt.toDouble())
            putDouble("timestamp", event.timestamp.toDouble())
        })
    }

    override fun onNetworkChange(state: NetworkSnapshot) = whenAttached { emitOnNetworkChange(state.toWritable()) }

    override fun onAuthHeadersNeeded(requestToken: String, requestId: String, httpStatus: Int) = whenAttached {
        emitOnAuthHeadersNeeded(Arguments.createMap().apply {
            putString("requestToken", requestToken)
            putString("requestId", requestId)
            putInt("httpStatus", httpStatus)
        })
    }

    override fun onConflict(event: ConflictEventData) = whenAttached {
        emitOnConflict(Arguments.createMap().apply {
            putString("id", event.id)
            putString("method", event.method)
            putString("url", event.url)
            putString("localBody", event.localBody)
            putString("serverBody", event.serverBody)
            putString("serverVersion", event.serverVersion)
            putInt("httpStatus", event.httpStatus)
        })
    }

    // endregion

    companion object {
        const val NAME = NativeSyncVaultSpec.NAME
    }
}

private fun ReadableMap.str(key: String): String? =
    if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

private fun ReadableMap.int(key: String, fallback: Int): Int =
    if (hasKey(key) && getType(key) == ReadableType.Number) getDouble(key).toInt() else fallback

private fun ReadableMap.bool(key: String, fallback: Boolean): Boolean =
    if (hasKey(key) && getType(key) == ReadableType.Boolean) getBoolean(key) else fallback

private fun ReadableMap.stringMap(key: String): Map<String, String> =
    if (hasKey(key) && getType(key) == ReadableType.Map) getMap(key)?.toStringMap() ?: emptyMap() else emptyMap()

private fun ReadableMap.toStringMap(): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    val it = keySetIterator()
    while (it.hasNextKey()) {
        val k = it.nextKey()
        when (getType(k)) {
            ReadableType.String -> getString(k)?.let { v -> out[k] = v }
            ReadableType.Number -> out[k] = getDouble(k).let { d -> if (d % 1.0 == 0.0) d.toLong().toString() else d.toString() }
            ReadableType.Boolean -> out[k] = getBoolean(k).toString()
            else -> Unit
        }
    }
    return out
}

private fun ReadableArray.strings(): List<String> = (0 until size()).mapNotNull { i -> getString(i) }

private fun NetworkSnapshot.toWritable(): WritableMap = Arguments.createMap().apply {
    putBoolean("isConnected", isConnected)
    putBoolean("isInternetReachable", isInternetReachable)
    putString("type", type)
    putBoolean("isExpensive", isExpensive)
    putBoolean("isConstrained", isConstrained)
}

private fun OutboxRow.toWritable(decryptedBody: String?): WritableMap = Arguments.createMap().apply {
    putString("id", id)
    putString("idempotencyKey", idempotencyKey)
    putString("queueKey", queueKey)
    putString("dedupeKey", dedupeKey)
    putString("method", method)
    putString("url", url)
    putMap("headers", Arguments.createMap().also { m -> headers.forEach { (k, v) -> m.putString(k, v) } })
    putString("body", decryptedBody)
    putString("contentType", contentType)
    putString("ifMatch", ifMatch)
    putString("status", status)
    putInt("priority", priority)
    putInt("attempt", attempt)
    putInt("maxAttempts", maxAttempts)
    putDouble("nextAttemptAt", nextAttemptAt.toDouble())
    putBoolean("authBlocked", authBlocked)
    putString("conflictStrategy", conflictStrategy)
    putString("lastError", lastError)
    putInt("lastHttpStatus", lastHttpStatus)
    putString("serverResponse", serverResponse)
    putString("serverVersion", serverVersion)
    putString("metadata", metadata)
    putDouble("createdAt", createdAt.toDouble())
    putDouble("updatedAt", updatedAt.toDouble())
    putDouble("completedAt", completedAt.toDouble())
}
