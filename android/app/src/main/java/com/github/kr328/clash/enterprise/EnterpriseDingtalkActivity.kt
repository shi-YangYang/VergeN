package com.github.kr328.clash.enterprise

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.github.kr328.clash.MainActivity
import com.github.kr328.clash.R
import com.github.kr328.clash.common.util.intent
import java.io.ByteArrayInputStream
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EnterpriseDingtalkActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var loginJob: Job? = null
    private var authorizationUrl: Uri? = null
    private var resumed = false
    private var loginComplete = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedState: Bundle?) {
        super.onCreate(savedState)
        setContentView(R.layout.activity_enterprise_dingtalk)

        web = findViewById(R.id.dingtalk_web)
        val status = findViewById<TextView>(R.id.dingtalk_status)
        val errorView = findViewById<View>(R.id.dingtalk_error)
        val fallback = findViewById<View>(R.id.dingtalk_fallback)
        val webLogin = findViewById<View>(R.id.dingtalk_web_login)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                !isAllowedNavigation(url)

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                request?.isForMainFrame == true && !isAllowedNavigation(request.url.toString())

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                if (request?.isForMainFrame == true && !isAllowedNavigation(request.url.toString())) {
                    WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                } else {
                    null
                }
        }

        fun openWebLogin() {
            val url = authorizationUrl ?: return
            webLogin.visibility = View.GONE
            status.visibility = View.GONE
            web.visibility = View.VISIBLE
            web.loadUrl(url.toString())
        }

        webLogin.setOnClickListener { openWebLogin() }
        fallback.setOnClickListener {
            loginJob?.cancel()
            startActivity(EnterpriseLoginActivity::class.intent)
            finish()
        }

        loginJob = lifecycleScope.launch {
            val api = EnterpriseKit.apiOrNull() ?: return@launch finish()
            var sessionId: String? = null
            try {
                val start = withContext(Dispatchers.IO) {
                    api.dingtalkQrStart().also { sessionId = it.sessionId }
                }
                val url = validatedAuthorizationUrl(start.qrUrl)
                    ?: error("Invalid DingTalk authorization URL")
                authorizationUrl = url
                while (!resumed) delay(POLL_MILLIS)
                if (openDingtalk(url)) {
                    status.setText(R.string.enterprise_dingtalk_opened)
                    webLogin.visibility = View.VISIBLE
                } else {
                    openWebLogin()
                }

                while (isActive) {
                    // Cancelling an in-flight poll on pause could discard its one-time login tokens.
                    if (!resumed) {
                        delay(POLL_MILLIS)
                        continue
                    }
                    val poll = withContext(Dispatchers.IO) {
                        runCatching { api.dingtalkQrPoll(start.sessionId) }.getOrNull()
                    }
                    when (poll?.status) {
                        "ok" -> {
                            val access = poll.accessToken.orEmpty()
                            val refresh = poll.refreshToken.orEmpty()
                            if (access.isBlank() || refresh.isBlank()) error("Missing login tokens")
                            webLogin.isEnabled = false
                            fallback.isEnabled = false
                            withContext(Dispatchers.IO) {
                                EnterpriseKit.coordinator.signInWithTokens(access, refresh, poll.user)
                                runCatching { EnterpriseKit.syncProfiles() }
                            }
                            loginComplete = true
                            finishLoginIfResumed()
                            return@launch
                        }
                        "fail", "expired" -> error("DingTalk authorization did not complete")
                    }
                    delay(POLL_MILLIS)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                web.stopLoading()
                web.visibility = View.GONE
                status.visibility = View.GONE
                webLogin.visibility = View.GONE
                errorView.visibility = View.VISIBLE
                fallback.isEnabled = true
            } finally {
                withContext(NonCancellable + Dispatchers.IO) {
                    sessionId?.let { api.dingtalkQrCancel(it) }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        finishLoginIfResumed()
    }

    override fun onPause() {
        resumed = false
        super.onPause()
    }

    override fun onDestroy() {
        loginJob?.cancel()
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }

    private fun finishLoginIfResumed() {
        if (!resumed || !loginComplete) return
        loginComplete = false
        startActivity(
            MainActivity::class.intent
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        finishAffinity()
    }

    private fun openDingtalk(url: Uri): Boolean {
        val link = Uri.Builder()
            .scheme("dingtalk")
            .authority("dingtalkclient")
            .path("/page/link")
            .appendQueryParameter("url", url.toString())
            .build()
        val intent = Intent(Intent.ACTION_VIEW, link).setPackage("com.alibaba.android.rimet")
        return try {
            if (intent.resolveActivity(packageManager) == null) return false
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }

    private fun validatedAuthorizationUrl(value: String): Uri? {
        val parsed = runCatching { URI(value) }.getOrNull() ?: return null
        if (!isDingtalkHttps(parsed) || parsed.rawPath != "/oauth2/auth" || parsed.rawFragment != null) return null
        val parameters = queryParameters(parsed) ?: return null
        if (parameters["redirect_uri"] != listOf(callbackUrl())) return null
        if (parameters["response_type"] != listOf("code")) return null
        if (parameters["prompt"] != listOf("consent")) return null
        if (parameters["scope"]?.singleOrNull() !in listOf("openid", "openid corpid")) return null
        if (parameters["client_id"]?.singleOrNull().isNullOrBlank()) return null
        if (parameters["state"]?.singleOrNull().isNullOrBlank()) return null
        return Uri.parse(value)
    }

    private fun isAllowedNavigation(value: String?): Boolean {
        val target = value ?: return false
        val parsed = runCatching { URI(target) }.getOrNull() ?: return false
        val authorizationParameters = authorizationUrl?.let { queryParameters(URI(it.toString())) } ?: return false
        if (isDingtalkHttps(parsed)) {
            if (parsed.rawPath != "/oauth2/auth") return true
            validatedAuthorizationUrl(target) ?: return false
            val parameters = queryParameters(parsed) ?: return false
            return parameters["state"] == authorizationParameters["state"] &&
                parameters["client_id"] == authorizationParameters["client_id"]
        }
        val callback = URI(callbackUrl())
        if (parsed.scheme != callback.scheme || parsed.rawAuthority != callback.rawAuthority ||
            parsed.rawPath != callback.rawPath || parsed.rawFragment != null
        ) return false
        val state = authorizationParameters["state"]?.singleOrNull() ?: return false
        return queryParameters(parsed)?.get("state") == listOf(state)
    }

    private fun queryParameters(url: URI): Map<String, List<String>>? = runCatching {
        url.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }.map { parameter ->
            val parts = parameter.split('=', limit = 2)
            URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }.groupBy({ it.first }, { it.second })
    }.getOrNull()

    private fun isDingtalkHttps(url: URI): Boolean =
        url.scheme == "https" && url.host == "login.dingtalk.com" &&
            url.rawUserInfo == null && (url.port == -1 || url.port == 443)

    private fun callbackUrl(): String =
        VERGEN_SERVER_URL.trimEnd('/') + "/api/v1/auth/dingtalk/callback"

    private companion object {
        const val POLL_MILLIS = 2000L
    }
}
