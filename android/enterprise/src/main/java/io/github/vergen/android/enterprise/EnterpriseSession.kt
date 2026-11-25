package io.github.vergen.android.enterprise

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import org.json.JSONException
import org.json.JSONObject

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

    val announcementEmployeeId: String?
        get() = read(KEY_ACCESS)?.let(::subject)

    val loginUsername: String?
        get() = read(KEY_USERNAME)

    // Only a session carried over from an older build may claim its username-only legacy receipts.
    fun legacyAnnouncementAccount(): Pair<String, String>? {
        if (prefs.contains(KEY_RECEIPT_AWARE_TOKEN)) return null
        val username = loginUsername ?: return null
        val id = announcementEmployeeId ?: return null
        return username to id
    }

    fun accessFor(employeeId: String): String? = read(KEY_ACCESS)?.takeIf { subject(it) == employeeId }

    // This is a local queue namespace, never a substitute for server-side JWT validation.
    private fun subject(token: String): String? = try {
        val payload = token.split('.', limit = 3)
        if (payload.size != 3) null else {
            val json = JSONObject(String(Base64.decode(payload[1], Base64.URL_SAFE), Charsets.UTF_8))
            json.optString("sub").toLongOrNull()?.takeIf { it > 0 }?.toString()
        }
    } catch (_: IllegalArgumentException) {
        null
    } catch (_: JSONException) {
        null
    }

    fun update(
        accessToken: String? = null,
        refreshToken: String? = null,
        configVersion: String? = null,
    ) {
        prefs.edit().apply {
            accessToken?.let {
                putString(KEY_ACCESS, EnterpriseCrypto.encrypt(it))
                putBoolean(KEY_RECEIPT_AWARE_TOKEN, true)
            }
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
        const val KEY_RECEIPT_AWARE_TOKEN = "announcement_receipt_aware_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_CONFIG_VERSION = "config_version"
        const val KEY_USERNAME = "username"
        const val KEY_DISPLAY_NAME = "display_name"
    }
}
