package com.syncvault.core

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.min
import kotlin.math.pow

/** Mirrors src/core/retryPolicy.ts; keep both in sync. */
object RetryPolicy {
    enum class Outcome { SUCCESS, CONFLICT, AUTH, RETRYABLE, PERMANENT }

    fun classify(httpStatus: Int): Outcome = when {
        httpStatus in 200..299 -> Outcome.SUCCESS
        httpStatus == 409 || httpStatus == 412 -> Outcome.CONFLICT
        httpStatus == 401 -> Outcome.AUTH
        httpStatus == 408 || httpStatus == 425 || httpStatus == 429 || httpStatus >= 500 -> Outcome.RETRYABLE
        else -> Outcome.PERMANENT
    }

    /** Exponential backoff with full jitter: random(0, min(max, base * 2^(attempt-1))). */
    fun backoffMs(attempt: Int, baseMs: Long, maxMs: Long, random: Double): Long {
        val exp = min(maxMs.toDouble(), baseMs * 2.0.pow((attempt - 1).coerceAtLeast(0)))
        return (exp * random.coerceIn(0.0, 1.0)).toLong()
    }

    /** Parses Retry-After as delta-seconds or an HTTP-date. Returns a delay in ms. */
    fun parseRetryAfterMs(value: String?, nowMs: Long): Long? {
        if (value.isNullOrBlank()) return null
        value.trim().toLongOrNull()?.let { return (it.coerceAtLeast(0)) * 1000 }
        return try {
            val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US)
            format.timeZone = TimeZone.getTimeZone("GMT")
            val date = format.parse(value.trim()) ?: return null
            (date.time - nowMs).coerceAtLeast(0)
        } catch (_: Exception) {
            null
        }
    }

    fun nextAttemptAt(
        nowMs: Long,
        attempt: Int,
        baseMs: Long,
        maxMs: Long,
        retryAfterMs: Long?,
        random: Double,
    ): Long = nowMs + maxOf(retryAfterMs ?: 0L, backoffMs(attempt, baseMs, maxMs, random))
}
