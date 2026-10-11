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
import kotlinx.coroutines.Dispatchers
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

    lateinit var coordinator: EnterpriseCoordinator
        private set

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
    }

    /**
     * Mirrors the desktop client: pull bootstrap, insert missing managed
     * profiles. The profile manager commits each URL over its own fetch
     * observer, so this is fire-and-forget per subscription. Deletions are
     * not automated yet — admins disable subscriptions instead.
     */
    suspend fun syncProfiles(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val stored = session.load()
            val token = stored.accessToken ?: return@runCatching false
            val api = apiHolder.api ?: return@runCatching false

            val bootstrap = api.bootstrap(token)
            session.update(configVersion = bootstrap.configVersion)

            withProfile {
                val existing = queryAll()
                bootstrap.subscriptions.forEach { subscription ->
                    if (existing.none { it.source == subscription.url }) {
                        create(
                            Profile.Type.Url,
                            subscription.name,
                            subscription.url,
                        )
                    }
                }
            }
            true
        }.getOrElse { it is ApiError }
    }
}
