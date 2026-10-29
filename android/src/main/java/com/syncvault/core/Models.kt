package com.syncvault.core

import org.json.JSONObject

object Status {
    const val PENDING = "pending"
    const val INFLIGHT = "inflight"
    const val SUCCEEDED = "succeeded"
    const val CONFLICT = "conflict"
    const val DEAD_LETTER = "dead_letter"
}

data class VaultConfig(
    val baseUrl: String = "",
    val maxConcurrency: Int = 4,
    val requestTimeoutMs: Int = 30_000,
    val leaseMs: Int = 120_000,
    val defaultMaxAttempts: Int = 8,
    val retryBaseDelayMs: Int = 1_000,
    val retryMaxDelayMs: Int = 300_000,
    val encryptPayloads: Boolean = true,
    val wifiOnly: Boolean = false,
    val requiresCharging: Boolean = false,
    val minBatteryLevel: Double = 0.0,
    val backgroundIntervalMinutes: Int = 15,
    val largePayloadThresholdBytes: Int = 512 * 1024,
    val notificationTitle: String = "Syncing changes",
) {
    /** A lease must outlive the request timeout, or a slow request could be sent twice. */
    val effectiveLeaseMs: Long get() = maxOf(leaseMs.toLong(), requestTimeoutMs.toLong() * 2 + 10_000)

    fun toJson(): String = JSONObject()
        .put("baseUrl", baseUrl)
        .put("maxConcurrency", maxConcurrency)
        .put("requestTimeoutMs", requestTimeoutMs)
        .put("leaseMs", leaseMs)
        .put("defaultMaxAttempts", defaultMaxAttempts)
        .put("retryBaseDelayMs", retryBaseDelayMs)
        .put("retryMaxDelayMs", retryMaxDelayMs)
        .put("encryptPayloads", encryptPayloads)
        .put("wifiOnly", wifiOnly)
        .put("requiresCharging", requiresCharging)
        .put("minBatteryLevel", minBatteryLevel)
        .put("backgroundIntervalMinutes", backgroundIntervalMinutes)
        .put("largePayloadThresholdBytes", largePayloadThresholdBytes)
        .put("notificationTitle", notificationTitle)
        .toString()

    companion object {
        fun fromJson(json: String?): VaultConfig {
            if (json.isNullOrEmpty()) return VaultConfig()
            val o = JSONObject(json)
            val d = VaultConfig()
            return VaultConfig(
                baseUrl = o.optString("baseUrl", d.baseUrl),
                maxConcurrency = o.optInt("maxConcurrency", d.maxConcurrency),
                requestTimeoutMs = o.optInt("requestTimeoutMs", d.requestTimeoutMs),
                leaseMs = o.optInt("leaseMs", d.leaseMs),
                defaultMaxAttempts = o.optInt("defaultMaxAttempts", d.defaultMaxAttempts),
                retryBaseDelayMs = o.optInt("retryBaseDelayMs", d.retryBaseDelayMs),
                retryMaxDelayMs = o.optInt("retryMaxDelayMs", d.retryMaxDelayMs),
                encryptPayloads = o.optBoolean("encryptPayloads", d.encryptPayloads),
                wifiOnly = o.optBoolean("wifiOnly", d.wifiOnly),
                requiresCharging = o.optBoolean("requiresCharging", d.requiresCharging),
                minBatteryLevel = o.optDouble("minBatteryLevel", d.minBatteryLevel),
                backgroundIntervalMinutes = o.optInt("backgroundIntervalMinutes", d.backgroundIntervalMinutes),
                largePayloadThresholdBytes = o.optInt("largePayloadThresholdBytes", d.largePayloadThresholdBytes),
                notificationTitle = o.optString("notificationTitle", d.notificationTitle),
            )
        }
    }
}

data class EnqueueInput(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String?,
    val contentType: String?,
    val idempotencyKey: String?,
    val queueKey: String?,
    val dedupeKey: String?,
    val ifMatch: String?,
    val priority: Int,
    val maxAttempts: Int,
    val conflictStrategy: String,
    val metadata: String?,
)

data class OutboxRow(
    val seq: Long,
    val id: String,
    val idempotencyKey: String,
    val queueKey: String?,
    val dedupeKey: String?,
    val method: String,
    val url: String,
    val queryParams: String?,
    val headers: Map<String, String>,
    val body: String?,
    val payloadRef: String?,
    val contentType: String?,
    val ifMatch: String?,
    val status: String,
    val priority: Int,
    val attempt: Int,
    val maxAttempts: Int,
    val nextAttemptAt: Long,
    val authBlocked: Boolean,
    val conflictStrategy: String,
    val lastError: String?,
    val lastHttpStatus: Int,
    val serverResponse: String?,
    val serverVersion: String?,
    val metadata: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val completedAt: Long,
)

data class QueueCounts(
    val pending: Int,
    val inflight: Int,
    val conflict: Int,
    val deadLetter: Int,
    val succeeded: Int,
    val authBlocked: Int,
)

data class NetworkSnapshot(
    val isConnected: Boolean,
    val isInternetReachable: Boolean,
    val type: String,
    val isExpensive: Boolean,
    val isConstrained: Boolean,
)

data class PowerSnapshot(
    val batteryLevel: Double,
    val isCharging: Boolean,
    val isLowPowerMode: Boolean,
)

data class CacheRow(
    val key: String,
    val value: String,
    val tags: List<String>,
    val expiresAt: Long,
    val createdAt: Long,
)

data class RequestEventData(
    val type: String,
    val id: String? = null,
    val status: String? = null,
    val attempt: Int = 0,
    val httpStatus: Int = 0,
    val error: String? = null,
    val nextAttemptAt: Long = 0,
    val timestamp: Long = System.currentTimeMillis(),
)

data class ConflictEventData(
    val id: String,
    val method: String,
    val url: String,
    val localBody: String?,
    val serverBody: String?,
    val serverVersion: String?,
    val httpStatus: Int,
)

/** Receives engine events. Implemented by the Turbo Module while JS is alive. */
interface VaultEventSink {
    fun onRequestEvent(event: RequestEventData)
    fun onNetworkChange(state: NetworkSnapshot)
    fun onAuthHeadersNeeded(requestToken: String, requestId: String, httpStatus: Int)
    fun onConflict(event: ConflictEventData)
}

internal fun mapToJson(map: Map<String, String>): String {
    val o = JSONObject()
    map.forEach { (k, v) -> o.put(k, v) }
    return o.toString()
}

internal fun jsonToMap(json: String?): Map<String, String> {
    if (json.isNullOrEmpty()) return emptyMap()
    return try {
        val o = JSONObject(json)
        val out = LinkedHashMap<String, String>()
        o.keys().forEach { k -> out[k] = o.optString(k) }
        out
    } catch (_: Exception) {
        emptyMap()
    }
}
