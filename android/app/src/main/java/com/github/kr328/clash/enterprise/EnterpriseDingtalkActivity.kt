package com.github.kr328.clash.enterprise

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
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
import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.ErrorKind
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class EnterpriseDingtalkActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var progress: View
    private lateinit var fallback: View
    private lateinit var webLogin: View
    private lateinit var errorView: TextView
    private lateinit var retry: View
    private var pollWakeups: Channel<Unit>? = null
    private var loginJob: Job? = null
    private var nativeLoginOpened = false
    private var usingWebLogin = false
    private var authorizationUrl: Uri? = null
    private var resumed = false
    private var loginComplete = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedState: Bundle?) {
        super.onCreate(savedState)
        if (intent.action == Intent.ACTION_VIEW || intent.data != null) {
            // A return link only resumes locally authenticated state; it never starts or completes authorization.
            if (isReturnIntent(intent)) openMain() else finish()
            return
        }
        setContentView(R.layout.activity_enterprise_dingtalk)

        web = findViewById(R.id.dingtalk_web)
        status = findViewById(R.id.dingtalk_status)
        progress = findViewById(R.id.dingtalk_progress)
        errorView = findViewById(R.id.dingtalk_error)
        retry = findViewById(R.id.dingtalk_retry)
        fallback = findViewById(R.id.dingtalk_fallback)
        webLogin = findViewById(R.id.dingtalk_web_login)

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleNavigation(url)

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                request?.isForMainFrame == true && handleNavigation(request.url.toString())

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
                if (request?.isForMainFrame == true && !isAllowedNavigation(request.url.toString())) {
                    WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                } else {
                    null
                }
        }

        webLogin.setOnClickListener { openWebLogin() }
        retry.setOnClickListener { startLogin() }
        fallback.setOnClickListener {
            loginJob?.cancel()
            if (isTaskRoot) startActivity(EnterpriseLoginActivity::class.intent)
            finish()
        }
        startLogin()
    }

    private fun openWebLogin() {
        val url = authorizationUrl ?: return
        usingWebLogin = true
        progress.visibility = View.GONE
        webLogin.visibility = View.GONE
        status.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(url.toString())
    }

    private fun showError(message: Int) {
        authorizationUrl = null
        nativeLoginOpened = false
        usingWebLogin = false
        web.stopLoading()
        web.visibility = View.GONE
        status.visibility = View.GONE
        webLogin.visibility = View.GONE
        progress.visibility = View.GONE
        errorView.setText(message)
        errorView.visibility = View.VISIBLE
        retry.visibility = View.VISIBLE
        fallback.visibility = View.VISIBLE
    }

    private fun startLogin() {
        loginJob?.cancel()
        val wakeups = Channel<Unit>(Channel.CONFLATED)
        pollWakeups = wakeups
        nativeLoginOpened = false
        usingWebLogin = false
        authorizationUrl = null
        loginComplete = false
        retry.visibility = View.GONE
        errorView.visibility = View.GONE
        progress.visibility = View.VISIBLE
        status.setText(R.string.enterprise_login_connecting)
        status.visibility = View.VISIBLE

        loginJob = lifecycleScope.launch {
            val api = EnterpriseKit.apiOrNull()
            var sessionId: String? = null
            try {
                if (api == null) return@launch showError(R.string.enterprise_server_unconfigured)
                val start = withContext(Dispatchers.IO) {
                    api.dingtalkQrStart(packageName).also { sessionId = it.sessionId }
                }
                require(start.sessionId.isNotBlank())
                val url = validatedAuthorizationUrl(start.qrUrl)
                    ?: error("Invalid DingTalk authorization URL")
                authorizationUrl = url
                val deadline = SystemClock.elapsedRealtime() + QR_LIFETIME_MILLIS
                while (!resumed && SystemClock.elapsedRealtime() < deadline) delay(POLL_MILLIS)
                if (SystemClock.elapsedRealtime() >= deadline) return@launch showError(R.string.enterprise_dingtalk_expired)
                nativeLoginOpened = openDingtalk(url)
                if (nativeLoginOpened) {
                    status.setText(R.string.enterprise_dingtalk_opened)
                    webLogin.visibility = View.VISIBLE
                } else {
                    openWebLogin()
                }

                var networkErrors = 0
                while (isActive && SystemClock.elapsedRealtime() < deadline) {
                    // DingTalk owns the foreground while authorizing; collect its one-time result in the background.
                    val poll = try {
                        withContext(Dispatchers.IO) { api.dingtalkQrPoll(start.sessionId) }.also { networkErrors = 0 }
                    } catch (e: Exception) {
                        if (!isNetworkFailure(e) || ++networkErrors >= POLL_ERROR_TOLERANCE) throw e
                        null
                    }
                    when (poll?.status) {
                        "ok" -> {
                            val access = poll.accessToken.orEmpty()
                            val refresh = poll.refreshToken.orEmpty()
                            if (access.isBlank() || refresh.isBlank()) error("Missing login tokens")
                            showCompleting()
                            EnterpriseKit.coordinator.signInWithTokens(access, refresh, poll.user)
                            loginComplete = true
                            finishLoginIfResumed()
                            return@launch
                        }
                        "expired" -> return@launch showError(R.string.enterprise_dingtalk_expired)
                        "pending", null -> Unit
                        else -> return@launch showError(R.string.enterprise_dingtalk_failed)
                    }
                    if (resumed && nativeLoginOpened && !usingWebLogin) {
                        status.setText(R.string.enterprise_dingtalk_opened)
                        webLogin.visibility = View.VISIBLE
                        fallback.visibility = View.VISIBLE
                    }
                    withTimeoutOrNull(POLL_MILLIS) { wakeups.receive() }
                }
                if (isActive) showError(R.string.enterprise_dingtalk_expired)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (isActive && pollWakeups === wakeups) {
                    showError(when {
                        isNetworkFailure(e) -> R.string.enterprise_login_network
                        e is ApiError && e.kind == ErrorKind.DINGTALK_NOT_CONFIGURED -> R.string.enterprise_dingtalk_unavailable
                        else -> R.string.enterprise_dingtalk_failed
                    })
                }
            } finally {
                wakeups.close()
                if (pollWakeups === wakeups) pollWakeups = null
                sessionId?.let { id ->
                    withContext(NonCancellable + Dispatchers.IO) { api?.dingtalkQrCancel(id) }
                }
            }
        }
    }

    private fun isNetworkFailure(error: Exception): Boolean =
        error is IOException || (error is ApiError && error.kind == ErrorKind.NETWORK)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (isReturnIntent(intent)) {
            refreshLoginResult()
            finishLoginIfResumed()
        }
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (nativeLoginOpened && !usingWebLogin) refreshLoginResult()
        finishLoginIfResumed()
    }

    override fun onPause() {
        resumed = false
        super.onPause()
    }

    override fun onDestroy() {
        loginJob?.cancel()
        if (::web.isInitialized) {
            web.stopLoading()
            web.destroy()
        }
        super.onDestroy()
    }

    private fun refreshLoginResult() {
        val wakeups = pollWakeups ?: return
        if (authorizationUrl == null || loginJob?.isActive != true) return
        usingWebLogin = false
        showCompleting()
        wakeups.trySend(Unit)
    }

    private fun showCompleting() {
        progress.visibility = View.VISIBLE
        web.visibility = View.GONE
        webLogin.visibility = View.GONE
        fallback.visibility = View.GONE
        status.visibility = View.VISIBLE
        status.setText(R.string.enterprise_dingtalk_completing)
    }

    private fun finishLoginIfResumed() {
        if (!resumed || !loginComplete) return
        loginComplete = false
        openMain()
    }

    private fun openMain() {
        startActivity(
            MainActivity::class.intent
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        finishAffinity()
    }

    private fun isReturnIntent(intent: Intent): Boolean =
        intent.action == Intent.ACTION_VIEW && intent.data?.toString() == RETURN_URI

    private fun handleNavigation(url: String?): Boolean {
        if (url == RETURN_URI) {
            refreshLoginResult()
            finishLoginIfResumed()
            return true
        }
        return !isAllowedNavigation(url)
    }

    private fun openDingtalk(url: Uri): Boolean {
        val link = Uri.Builder()
            .scheme("dingtalk")
            .authority("dingtalkclient")
            .path("/page/link")
            .appendQueryParameter("url", url.toString())
            .build()
        val intent = Intent(Intent.ACTION_VIEW, link)
            .setPackage("com.alibaba.android.rimet")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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
        const val POLL_ERROR_TOLERANCE = 3
        const val QR_LIFETIME_MILLIS = 5 * 60_000L
        const val RETURN_URI = "vergen://auth/dingtalk"
    }
}
