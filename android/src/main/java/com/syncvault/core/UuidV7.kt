package com.syncvault.core

import java.security.SecureRandom

/** RFC 9562 UUIDv7: 48-bit ms timestamp, monotonic within the same millisecond. */
object UuidV7 {
    private val random = SecureRandom()
    private var lastMs = 0L
    private var counter = 0

    @Synchronized
    fun generate(nowMs: Long = System.currentTimeMillis()): String {
        var ms = nowMs
        if (ms <= lastMs) {
            counter++
            if (counter > 0xFFF) {
                lastMs++
                counter = 0
            }
            ms = lastMs
        } else {
            lastMs = ms
            counter = random.nextInt(0x800)
        }
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        bytes[0] = (ms ushr 40).toByte()
        bytes[1] = (ms ushr 32).toByte()
        bytes[2] = (ms ushr 24).toByte()
        bytes[3] = (ms ushr 16).toByte()
        bytes[4] = (ms ushr 8).toByte()
        bytes[5] = ms.toByte()
        bytes[6] = (0x70 or ((counter ushr 8) and 0x0F)).toByte()
        bytes[7] = (counter and 0xFF).toByte()
        bytes[8] = ((bytes[8].toInt() and 0x3F) or 0x80).toByte()
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }
}
