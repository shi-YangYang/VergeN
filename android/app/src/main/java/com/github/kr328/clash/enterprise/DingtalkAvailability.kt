package com.github.kr328.clash.enterprise

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The login activity retains this round across rotation and the trip to DingTalk. */
class DingtalkAvailability(application: Application) : AndroidViewModel(application) {
    data class State(val enabled: Boolean?, val checking: Boolean)

    private val server = runCatching { URI(VERGEN_SERVER_URL.trim()) }.getOrNull()
        ?.takeIf {
            it.scheme in listOf("https", "http") && it.host != null &&
                it.rawUserInfo == null && it.rawQuery == null && it.rawFragment == null
        }?.toASCIIString()?.trimEnd('/')
    val configured get() = server != null
    private val prefs = application.getSharedPreferences("enterprise_dingtalk_enabled", Context.MODE_PRIVATE)
    private val current = MutableStateFlow(State(server?.let { prefs.all[it] as? Boolean }, false))
    val state = current.asStateFlow()

    init {
        recheck()
    }

    fun recheck() {
        val key = server ?: return
        if (current.value.checking) return
        current.value = current.value.copy(checking = true)
        viewModelScope.launch {
            val delays = longArrayOf(2_000, 4_000, 8_000, 8_000)
            for (attempt in 0..delays.size) {
                val confirmed = try {
                    withContext(Dispatchers.IO) { EnterpriseKit.apiOrNull()?.capabilities()?.dingtalkQr }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }
                if (confirmed != null) {
                    prefs.edit().putBoolean(key, confirmed).apply()
                    current.value = State(confirmed, false)
                    return@launch
                }
                if (attempt < delays.size) delay(delays[attempt])
            }
            current.value = current.value.copy(checking = false)
        }
    }
}
