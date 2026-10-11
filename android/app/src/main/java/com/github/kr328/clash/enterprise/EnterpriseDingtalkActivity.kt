package com.github.kr328.clash.enterprise

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.github.kr328.clash.MainActivity
import com.github.kr328.clash.R
import com.github.kr328.clash.common.util.intent
import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.ErrorKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * DingTalk QR login for phones: the device IS the scanner, so instead of
 * showing a QR image we load the DingTalk confirm page in a WebView (the
 * DingTalk page offers "打开钉钉一键登录"), then poll our server for the
 * authorized token pair, mirroring the desktop client.
 */
class EnterpriseDingtalkActivity : AppCompatActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedState: Bundle?) {
        super.onCreate(savedState)
        setContentView(R.layout.activity_enterprise_dingtalk)

        val web = findViewById<WebView>(R.id.dingtalk_web)
        val error = findViewById<View>(R.id.dingtalk_error)
        val fallback = findViewById<View>(R.id.dingtalk_fallback)

        web.settings.javaScriptEnabled = true
        web.isVerticalScrollBarEnabled = true

        lifecycleScope.launch(Dispatchers.IO) {
            val api = EnterpriseKit.apiOrNull()
                ?: return@launch finish()

            val capabilities = runCatching { api.capabilities() }.getOrNull()
            if (capabilities?.dingtalkQr != true) {
                withContext(Dispatchers.Main) { finish() }
                return@launch
            }

            val start = runCatching { api.dingtalkQrStart() }.getOrNull()
            if (start == null) {
                withContext(Dispatchers.Main) {
                    error.visibility = View.VISIBLE
                    fallback.visibility = View.VISIBLE
                }
                return@launch
            }

            withContext(Dispatchers.Main) {
                web.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        url: String?,
                    ): Boolean = false
                }
                web.loadUrl(start.qrUrl)
            }

            while (kotlin.coroutines.coroutineContext[kotlinx.coroutines.Job]?.isActive == true) {
                val poll = runCatching { api.dingtalkQrPoll(start.sessionId) }.getOrNull()
                when (poll?.status) {
                    "authorized" -> {
                        val access = poll.accessToken.orEmpty()
                        val refresh = poll.refreshToken.orEmpty()
                        if (access.isNotBlank()) {
                            val outcome = runCatching {
                                EnterpriseKit.coordinator.signInWithTokens(access, refresh)
                            }
                            if (outcome.isSuccess) {
                                runCatching {
                                    EnterpriseKit.syncProfiles()
                                }
                                withContext(Dispatchers.Main) {
                                    val intent = MainActivity::class.intent
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
                                    startActivity(intent)
                                    finishAffinity()
                                }
                                return@launch
                            }
                        }
                        api.dingtalkQrCancel(start.sessionId)
                        withContext(Dispatchers.Main) {
                            error.visibility = View.VISIBLE
                            fallback.visibility = View.VISIBLE
                        }
                        return@launch
                    }

                    "failed", "expired" -> {
                        withContext(Dispatchers.Main) {
                            error.visibility = View.VISIBLE
                            fallback.visibility = View.VISIBLE
                        }
                        return@launch
                    }
                }
                delay(POLL_MILLIS)
            }
        }

        fallback.setOnClickListener {
            startActivity(EnterpriseLoginActivity::class.intent)
            finish()
        }
    }

    private companion object {
        const val POLL_MILLIS = 2000L
    }
}
