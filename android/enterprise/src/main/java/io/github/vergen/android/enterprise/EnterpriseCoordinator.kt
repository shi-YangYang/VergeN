package io.github.vergen.android.enterprise

import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

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
 * Authorization calls wrap [author]: on 401 the refresh token buys a fresh
 * pair once; when that also fails the session clears (admin disabled the
 * user) and the failure rethrows.
 */
class EnterpriseCoordinator(
    private val apiHolder: EnterpriseApiHolder,
    private val session: EnterpriseSession,
    private val appVersion: String,
    private val onSyncRequired: suspend () -> Unit,
) {
    private val running = AtomicReference<CoroutineScope?>(null)
    private val authorLock = Mutex()

    fun start(scope: CoroutineScope) {
        if (!running.compareAndSet(null, scope)) return
        scope.launch(Dispatchers.IO) {
            while (true) {
                runCatching { tick() }
                delay(HEARTBEAT_MILLIS)
            }
        }
    }

    /** Returns true when local state matched the server (nothing to re-sync). */
    suspend fun tick(): Boolean {
        val api = apiHolder.api ?: return false
        return try {
            author { token ->
                val stored = session.load()
                val response = api.heartbeat(token, appVersion, stored.configVersion.orEmpty())
                val serverVersion = response.configVersion
                if (!serverVersion.isNullOrEmpty() && serverVersion != stored.configVersion) {
                    session.update(configVersion = serverVersion)
                    onSyncRequired()
                }
            }
            true
        } catch (e: ApiError) {
            when (e.kind) {
                ErrorKind.BAD_CREDENTIALS, ErrorKind.FORBIDDEN -> false
                else -> false
            }
        }
    }

    /** Login with password → tokens stored → immediate bootstrap. */
    suspend fun signIn(username: String, password: String): List<BootstrapSubscription> {
        val api = apiHolder.api
            ?: throw ApiError(ErrorKind.NETWORK)
        val login = withContext(Dispatchers.IO) { api.login(username, password) }
        session.updateUser(login.user ?: EnterpriseUser(username = username))
        session.update(
            accessToken = login.accessToken,
            refreshToken = login.refreshToken,
        )
        val bootstrap = withContext(Dispatchers.IO) { api.bootstrap(login.accessToken) }
        session.updateUser(bootstrap.user)
        bootstrap.configVersion?.let { session.update(configVersion = it) }
        return bootstrap.subscriptions
    }

    /** Accepts a token pair minted by the DingTalk QR flow. */
    suspend fun signInWithTokens(
        accessToken: String,
        refreshToken: String,
        user: EnterpriseUser? = null,
    ): List<BootstrapSubscription> {
        session.updateUser(user)
        val bootstrap = withContext(Dispatchers.IO) {
            (apiHolder.api ?: throw ApiError(ErrorKind.NETWORK)).bootstrap(accessToken)
        }
        session.updateUser(bootstrap.user)
        session.update(
            accessToken = accessToken,
            refreshToken = refreshToken,
        )
        bootstrap.configVersion?.let { session.update(configVersion = it) }
        return bootstrap.subscriptions
    }

    suspend fun signOut() {
        val stored = session.load()
        stored.refreshToken?.let { token ->
            runCatching {
                apiHolder.api?.logout(token)
            }
        }
        session.clear()
    }

    /** Pull bootstrap only (offline-safe); used after app start with a session. */
    suspend fun syncNow(): List<BootstrapSubscription> {
        val api = apiHolder.api ?: throw ApiError(ErrorKind.NETWORK)
        return withContext(Dispatchers.IO) {
            author { token ->
                val bootstrap = api.bootstrap(token)
                session.updateUser(bootstrap.user)
                if (stored() != bootstrap.configVersion) {
                    session.update(configVersion = bootstrap.configVersion)
                }
                bootstrap.subscriptions
            }
        }
    }

    val isSignedIn: Boolean
        get() = !session.load().accessToken.isNullOrEmpty()

    val accountName: String?
        get() = session.load().let { it.displayName ?: it.username }

    /**
     * Authorization wrapper. All authorized calls funnel through a single
     * mutex: the server rotates refresh tokens one-time, so two concurrent
     * 401 retries would race — the loser's refresh is already consumed and
     * the session gets wiped. Serializing makes the second caller reuse the
     * freshly stored pair.
     */
    private suspend fun <T> author(block: suspend (String) -> T): T =
        authorLock.withLock {
            val api = apiHolder.api ?: throw ApiError(ErrorKind.NETWORK)
            val stored = session.load()
            val token = stored.accessToken ?: throw ApiError(ErrorKind.BAD_CREDENTIALS)
            try {
                block(token)
            } catch (e: ApiError) {
                if (e.kind != ErrorKind.BAD_CREDENTIALS) throw e

                val refreshToken = session.load().refreshToken
                    ?: run {
                        session.clear()
                        throw e
                    }
                try {
                    val refreshed = withContext(Dispatchers.IO) { api.refresh(refreshToken) }
                    session.updateUser(refreshed.user)
                    session.update(
                        accessToken = refreshed.accessToken,
                        refreshToken = refreshed.refreshToken,
                    )
                    block(refreshed.accessToken)
                } catch (_: ApiError) {
                    session.clear()
                    throw e
                }
            }
        }

    private fun stored(): String? = session.load().configVersion

    private companion object {
        const val HEARTBEAT_MILLIS = 5L * 60 * 1000
    }
}
