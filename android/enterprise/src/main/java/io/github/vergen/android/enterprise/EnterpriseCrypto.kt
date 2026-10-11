package io.github.vergen.android.enterprise

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// AES-256-GCM via AndroidKeyStore: the plaintext never exists on disk. Every
// persisted blob is "b64(iv) . b64(payload)" and decrypt failures map to null
// so legacy/corrupt values drop back to anonymous state instead of crashing —
// mirroring the desktop client's encryption scheme.
object EnterpriseCrypto {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "vergen_enterprise"
    private const val GCM_TAG_BITS = 128
    private const val SEPARATOR = " . "

    fun encrypt(value: String): String {
        val cipher = cipher(Cipher.ENCRYPT_MODE)
        val payload = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val iv = android.util.Base64.encodeToString(
            cipher.iv,
            android.util.Base64.NO_WRAP,
        )
        val encoded = android.util.Base64.encodeToString(
            payload,
            android.util.Base64.NO_WRAP,
        )
        return listOf(iv, encoded).joinToString(SEPARATOR)
    }

    fun decrypt(blob: String): String? {
        val parts = blob.split(SEPARATOR)
        if (parts.size != 2) return null
        return try {
            val iv = android.util.Base64.decode(parts[0], android.util.Base64.NO_WRAP)
            val payload = android.util.Base64.decode(parts[1], android.util.Base64.NO_WRAP)
            cipher(Cipher.DECRYPT_MODE, iv).doFinal(payload)?.toString(Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    private fun cipher(mode: Int, iv: ByteArray? = null): Cipher {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(mode, key(), iv?.let { GCMParameterSpec(GCM_TAG_BITS, it) })
        return cipher
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as KeyStore.SecretKeyEntry?)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE,
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }
}
