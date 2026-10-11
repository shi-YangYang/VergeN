package com.github.kr328.clash.enterprise

import android.content.Context
import com.github.kr328.clash.common.util.intent
import com.github.kr328.clash.service.model.Profile
import com.github.kr328.clash.util.withProfile
import com.github.kr328.clash.MainActivity
import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.EnterpriseApi
import io.github.vergen.android.enterprise.EnterpriseApiHolder
import io.github.vergen.android.enterprise.EnterpriseCoordinator
import io.github.vergen.android.enterprise.EnterpriseSession
import com.github.kr328.clash.common.log.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

// 服务地址随构建注入(CI 用 -PvergenServerAddr=… / 本地默认局域网地址)。
const val VERGEN_SERVER_URL = "http://192.168.0.102:8080"

/**
 * App-facing bridge to the enterprise layer: lazily wires the session, the
 * HTTP client and the coordinator, and reconciles managed subscriptions
 * against the local profile list — the same semantics the desktop client
 * uses for its bootstrap sync.
 */
object EnterpriseKit {
    private lateinit var apiHolder: EnterpriseApiHolder
    private lateinit var session: EnterpriseSession
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var coordinator: EnterpriseCoordinator
        private set

    fun apiOrNull(): io.github.vergen.android.enterprise.EnterpriseApi? {
        if (!::session.isInitialized) return null
        return apiHolder.api
    }

    @Synchronized
    fun init(context: Context) {
        if (::session.isInitialized) return

        session = EnterpriseSession(context.applicationContext)
        apiHolder = EnterpriseApiHolder(VERGEN_SERVER_URL)

        coordinator = EnterpriseCoordinator(
            apiHolder = apiHolder,
            session = session,
            appVersion = try {
                context.packageManager.getPackageInfo(context.packageName, 0)?.versionName ?: "?"
            } catch (_: Exception) {
                "?"
            },
            onSyncRequired = { syncProfiles() },
        )
        coordinator.start(backgroundScope)
    }

    /**
     * Mirrors the desktop client: pull bootstrap, insert missing managed
     * profiles. The profile manager commits each URL over its own fetch
     * observer, so this is fire-and-forget per subscription. Deletions are
     * not automated yet — admins disable subscriptions instead.
     */
    suspend fun syncProfiles(): Boolean = withContext(Dispatchers.IO) {
        // 服务进程绑定是异步的;刚装完/冷启动时 binder 未就绪,重试直至可用。
        repeat(SYNC_ATTEMPTS) { attempt ->
            try {
                // syncNow 走 author():401 时自动用 refresh token 换新再重试。
                val subscriptions = coordinator.syncNow()
                if (subscriptions.isEmpty()) return@withContext true

                withProfile {
                    val existing = queryAll()
                    subscriptions.forEach { subscription ->
                        val profile = existing.firstOrNull { it.source == subscription.url }
                        val uuid = profile?.uuid
                            ?: create(Profile.Type.Url, subscription.name, subscription.url)
                                .also { Log.d("managed profile created: ${subscription.name}") }
                        // commit 会拉取订阅内容并落库;没有它 profile 永远停在 pending("Unsaved"),无法激活。
                        if (profile == null || profile.pending) {
                            commit(uuid, null)
                            Log.d("managed profile committed: ${subscription.name}")
                        }
                    }
                }
                return@withContext true
            } catch (e: Throwable) {
                Log.w("sync attempt ${attempt + 1} failed", e)
                // 只有网络故障值得重试;账停/解析失败直接放弃等用户重进。
                if (e !is kotlinx.coroutines.CancellationException &&
                    !isTransient(e) || attempt == SYNC_ATTEMPTS - 1
                ) return@withContext false
                delay(SYNC_RETRY_MILLIS)
            }
        }
        false
    }
}

private const val SYNC_ATTEMPTS = 12
private const val SYNC_RETRY_MILLIS = 3000L

private fun isTransient(e: Throwable): Boolean =
    e is io.github.vergen.android.enterprise.ApiError &&
        (e.kind == io.github.vergen.android.enterprise.ErrorKind.NETWORK ||
            e.kind == io.github.vergen.android.enterprise.ErrorKind.HTTP)
