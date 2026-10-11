package io.github.vergen.android.enterprise

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Orchestrates bootstrap + heartbeat against the vergen-server:
 *
 *  - [start]: background loop drives `POST /client/heartbeat` every five
 *    minutes while the app process lives; whenever the server bumps its
 *    config_version (subscriptions/announcements changed), the callback
 *    re-syncs profiles.
 *  - [syncNow]: foreground fetch of `GET /client/bootstrap`, used by the UI
 *    after login.
 *
 * 401/403 mean the admin disabled the user; callers treat that as logout.
 */
class EnterpriseCoordinator(
    private val apiHolder: EnterpriseApiHolder,
    private val session: EnterpriseSession,
    private val appVersion: String,
    private val onSyncRequired: suspend () -> Unit,
) {
    private val running = AtomicReference<CoroutineScope?>(null)

    fun start(scope: CoroutineScope) {
        if (!running.compareAndSet(null, scope)) return
        scope.launch(Dispatchers.IO) {
            while (true) {
                runCatching { tick() }
                    .onFailure { if (it is ApiError && it.code in 401..403) { /* surfaced below */ } }
                delay(HEARTBEAT_MILLIS)
            }
        }
    }

    /** Returns true when local state matched the server (nothing to re-sync). */
    suspend fun tick(): Boolean {
        val stored = session.load()
        val token = stored.accessToken ?: return false
        val api = apiHolder.api ?: return false
        return try {
            val response = api.heartbeat(token, appVersion, stored.configVersion.orEmpty())
            val serverVersion = response.configVersion
            if (!serverVersion.isNullOrEmpty() && serverVersion != stored.configVersion) {
                session.update(configVersion = serverVersion)
                onSyncRequired()
                false
            } else {
                true
            }
        } catch (e: ApiError) {
            when (e.kind) {
                ErrorKind.BAD_CREDENTIALS, ErrorKind.FORBIDDEN -> {
                    session.clear()
                    false
                }
                else -> false
            }
        }
    }

    /** Login → tokens stored → immediate bootstrap; returns subscription list. */
    suspend fun signIn(username: String, password: String): List<BootstrapSubscription> {
        val api = apiHolder.api
            ?: throw ApiError(ErrorKind.NETWORK)
        val login = api.login(username, password)
        session.update(
            accessToken = login.accessToken,
            refreshToken = login.refreshToken,
        )
        val bootstrap = api.bootstrap(login.accessToken)
        session.update(configVersion = bootstrap.configVersion)
        return bootstrap.subscriptions
    }

    suspend fun signOut() {
        val stored = session.load()
        stored.refreshToken?.let { token ->
            runCatching { apiHolder.sessionApi?.let { it.logout(token) } }
        }
        session.clear()
    }

    /** Pull bootstrap only (offline-safe); used after app start with a session. */
    suspend fun syncNow(): List<BootstrapSubscription> {
        val stored = session.load()
        val token = stored.accessToken ?: throw ApiError(ErrorKind.BAD_CREDENTIALS)
        val api = apiHolder.api ?: throw ApiError(ErrorKind.NETWORK)
        val bootstrap = api.bootstrap(token)
        if (stored.configVersion != bootstrap.configVersion) {
            session.update(configVersion = bootstrap.configVersion)
        }
        return bootstrap.subscriptions
    }

    val isSignedIn: Boolean
        get() = !session.load().accessToken.isNullOrEmpty()

    private companion object {
        const val HEARTBEAT_MILLIS = 5L * 60 * 1000
    }
}

/**
 * Holds the concrete [EnterpriseApi] once the deployment URL is known;
 * the server address is shipped at build time so users never type it.
 */
class EnterpriseApiHolder(
    private val baseUrl: String,
) {
    val api: EnterpriseApi? = runCatching {
        EnterpriseApi(baseUrl)
    }.getOrNull()
    var sessionApi: EnterpriseApi? = api
}
