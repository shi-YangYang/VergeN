package com.github.kr328.clash.enterprise

import android.content.Context
import android.content.SharedPreferences
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.UUID

// 生产服务地址,烧进每个客户端构建;本地内网调试时手动改回局域网地址,勿提交。
const val VERGEN_SERVER_URL = "https://106.52.87.40"

/**
 * App-facing bridge to the enterprise layer: lazily wires the session, the
 * HTTP client and the coordinator, and reconciles managed subscriptions
 * against the local profile list — the same semantics the desktop client
 * uses for its bootstrap sync.
 */
object EnterpriseKit {
    private lateinit var apiHolder: EnterpriseApiHolder
    private lateinit var session: EnterpriseSession
    private lateinit var managedProfiles: SharedPreferences
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val syncLock = Mutex()

    lateinit var coordinator: EnterpriseCoordinator
        private set

    /**
     * Profiles inserted by the sync are managed: the subscription source can
     * be any third-party URL the admin chose, so "managed" is tracked per
     * uuid (persisted) rather than guessed from the source. The UI must not
     * expose update/edit/duplicate/share for them — the server pushes new
     * content via config_version and the sync refetches.
     */
    fun isManaged(profile: Profile): Boolean =
        ::managedProfiles.isInitialized &&
            managedProfiles.getStringSet(KEY_MANAGED, emptySet())
                ?.contains(profile.uuid.toString()) == true

    private fun markManaged(uuid: UUID) {
        // SharedPreferences returns the live set — copy before mutating.
        val set = managedProfiles.getStringSet(KEY_MANAGED, null)?.toMutableSet()
            ?: mutableSetOf()
        if (set.add(uuid.toString()))
            managedProfiles.edit().putStringSet(KEY_MANAGED, set).apply()
    }

    fun apiOrNull(): io.github.vergen.android.enterprise.EnterpriseApi? {
        if (!::session.isInitialized) return null
        return apiHolder.api
    }

    @Synchronized
    fun init(context: Context) {
        if (::session.isInitialized) return

        val appContext = context.applicationContext
        session = EnterpriseSession(appContext)
        managedProfiles = appContext.getSharedPreferences(
            MANAGED_PREFS_NAME,
            Context.MODE_PRIVATE,
        )
        apiHolder = EnterpriseApiHolder(VERGEN_SERVER_URL)

        coordinator = EnterpriseCoordinator(
            apiHolder = apiHolder,
            session = session,
            appVersion = try {
                appContext.packageManager.getPackageInfo(appContext.packageName, 0)?.versionName ?: "?"
            } catch (_: Exception) {
                "?"
            },
            onSyncRequired = { syncProfiles() },
        )
        coordinator.start(backgroundScope)
    }

    /**
     * Mirrors the desktop client: pull bootstrap, reconcile the managed
     * profiles — insert missing ones, commit pending ones (the fetch
     * otherwise never starts), refetch stale ones so admin-driven content
     * updates arrive without manual interaction. Deletions are not
     * automated yet — admins disable subscriptions instead.
     */
    suspend fun syncProfiles(): Boolean = withContext(Dispatchers.IO) {
        // 匹配/创建/清理必须串行:并发 sync 都看到条目不存在会各自导入
        // (桌面端的 ensure managed profile 出现过同一秒导入两条的情况)。
        syncLock.withLock {
            // 服务进程绑定是异步的;刚装完/冷启动时 binder 未就绪,重试直至可用。
            repeat(SYNC_ATTEMPTS) { attempt ->
                try {
                    // syncNow 走 author():401 时自动用 refresh token 换新再重试。
                    val subscriptions = coordinator.syncNow()
                    if (subscriptions.isEmpty()) return@withContext true

                    withProfile {
                        val existing = queryAll()
                        val syncedUuids = subscriptions.map { subscription ->
                            // 重复项清理:保留已登记过的那个,其余删除。
                            val matches = existing.filter { it.source == subscription.url }
                            val keep = matches.firstOrNull { isManaged(it) } ?: matches.firstOrNull()
                            matches.filter { it.uuid != keep?.uuid }.forEach { duplicate ->
                                delete(duplicate.uuid)
                                Log.d("managed duplicate removed: ${subscription.name}")
                            }
                            val profile = keep
                            val uuid = profile?.uuid
                                ?: create(Profile.Type.Url, subscription.name, subscription.url)
                                    .also { Log.d("managed profile created: ${subscription.name}") }
                            val renamed = profile != null && profile.name != subscription.name
                            if (profile != null && renamed) {
                                patch(uuid, subscription.name, profile.source, profile.interval, profile.ageSecretKey)
                            }
                            if (profile == null || profile.pending || renamed) {
                                commit(uuid, null)
                                Log.d("managed profile committed: ${subscription.name}")
                            } else if (System.currentTimeMillis() - profile.updatedAt > REFETCH_MILLIS) {
                                update(uuid)
                                Log.d("managed profile refetched: ${subscription.name}")
                            }
                            markManaged(uuid)
                            uuid
                        }
                        if (queryActive() == null) {
                            val profile = queryByUUID(syncedUuids.first())
                            if (profile != null && profile.imported) {
                                setActive(profile)
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
}

private const val SYNC_ATTEMPTS = 12
private const val SYNC_RETRY_MILLIS = 3000L
private const val REFETCH_MILLIS = 5L * 60 * 1000
private const val MANAGED_PREFS_NAME = "vergen_managed_profiles"
private const val KEY_MANAGED = "managed_uuids"

private fun isTransient(e: Throwable): Boolean =
    e is io.github.vergen.android.enterprise.ApiError &&
        (e.kind == io.github.vergen.android.enterprise.ErrorKind.NETWORK ||
            e.kind == io.github.vergen.android.enterprise.ErrorKind.HTTP)
