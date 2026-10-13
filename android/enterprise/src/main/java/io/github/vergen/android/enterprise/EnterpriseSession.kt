package io.github.vergen.android.enterprise

import android.content.Context
import android.content.SharedPreferences

/**
 * Device-scoped enterprise session. Tokens and the deployed config version
 * are AES ciphertext at rest (keystore-backed), so a copied prefs file is
 * unreadable outside this device.
 */
class EnterpriseSession(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(
            PREFS_NAME,
            Context.MODE_PRIVATE,
        )

    data class Stored(
        val accessToken: String?,
        val refreshToken: String?,
        val configVersion: String?,
        val username: String?,
        val displayName: String?,
    )

    fun load(): Stored = Stored(
        read(KEY_ACCESS),
        read(KEY_REFRESH),
        read(KEY_CONFIG_VERSION),
        read(KEY_USERNAME),
        read(KEY_DISPLAY_NAME),
    )

    fun update(
        accessToken: String? = null,
        refreshToken: String? = null,
        configVersion: String? = null,
    ) {
        prefs.edit().apply {
            accessToken?.let { putString(KEY_ACCESS, EnterpriseCrypto.encrypt(it)) }
            refreshToken?.let { putString(KEY_REFRESH, EnterpriseCrypto.encrypt(it)) }
            configVersion?.let { putString(KEY_CONFIG_VERSION, EnterpriseCrypto.encrypt(it)) }
        }.apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun updateUser(user: EnterpriseUser?) {
        val username = user?.username?.trim()?.takeIf { it.isNotEmpty() }
        val displayName = user?.displayName?.trim()?.takeIf { it.isNotEmpty() }
        prefs.edit().apply {
            putString(KEY_USERNAME, username?.let { EnterpriseCrypto.encrypt(it) })
            putString(KEY_DISPLAY_NAME, displayName?.let { EnterpriseCrypto.encrypt(it) })
        }.apply()
    }

    private fun read(key: String): String? =
        prefs.getString(key, null)?.let { EnterpriseCrypto.decrypt(it) }

    private companion object {
        const val PREFS_NAME = "vergen_enterprise"
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_CONFIG_VERSION = "config_version"
        const val KEY_USERNAME = "username"
        const val KEY_DISPLAY_NAME = "display_name"
    }
}
