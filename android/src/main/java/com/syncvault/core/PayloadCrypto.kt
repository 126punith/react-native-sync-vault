package com.syncvault.core

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class UndecryptableException(message: String, cause: Throwable?) : Exception(message, cause)

/**
 * AES-256-GCM field encryption with a non-exportable Android Keystore key.
 * Values are stored as "enc:v1:" + base64(iv || ciphertext). Unprefixed values are
 * treated as plaintext so rows imported from v1 keep working.
 */
class PayloadCrypto {
    private val keyAlias = "sync_vault_payload_key_v1"
    private val prefix = "enc:v1:"

    @Volatile
    private var key: SecretKey? = null

    private fun secretKey(): SecretKey {
        key?.let { return it }
        synchronized(this) {
            key?.let { return it }
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val existing = ks.getKey(keyAlias, null) as? SecretKey
            val resolved = existing ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(
                    KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
                generateKey()
            }
            key = resolved
            return resolved
        }
    }

    /** Never loses data: if the Keystore is unavailable the value is stored as plaintext. */
    fun encrypt(plain: String?): String? {
        if (plain == null) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            val out = ByteArray(cipher.iv.size + ct.size)
            System.arraycopy(cipher.iv, 0, out, 0, cipher.iv.size)
            System.arraycopy(ct, 0, out, cipher.iv.size, ct.size)
            prefix + Base64.encodeToString(out, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.w("SyncVault", "Keystore encryption unavailable, storing plaintext", e)
            plain
        }
    }

    fun decrypt(stored: String?): String? {
        if (stored == null || !stored.startsWith(prefix)) return stored
        try {
            val raw = Base64.decode(stored.substring(prefix.length), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, raw, 0, 12))
            return String(cipher.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        } catch (e: Exception) {
            throw UndecryptableException("Stored payload cannot be decrypted (Keystore key missing or changed)", e)
        }
    }
}
