package com.github.kr328.clash.enterprise

import android.content.Context
import android.content.SharedPreferences
import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.EmployeeAnnouncement
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import java.security.MessageDigest

internal data class NoticeRevision(val id: Long, val revision: String) {
    val key get() = "$id:$revision"
}

internal fun EmployeeAnnouncement.version() = NoticeRevision(id, revision)

internal interface AnnouncementOutbox {
    fun pending(): List<NoticeRevision>
    fun known(item: NoticeRevision): Boolean
    fun enqueue(item: NoticeRevision): Boolean
    fun defer(item: NoticeRevision)
    fun delivered(item: NoticeRevision)
}

internal class DeviceAnnouncementOutbox(
    private val entries: SharedPreferences,
    private val legacy: SharedPreferences,
    private val employeeId: String,
    private val legacyOwnerKey: String?,
    private val legacyKey: (NoticeRevision) -> String?,
) : AnnouncementOutbox {
    override fun pending(): List<NoticeRevision> = synchronized(entries) {
        entries.all.mapNotNull { (key, state) ->
            if (state != PENDING) return@mapNotNull null
            val id = key.substringBefore(':').toLongOrNull() ?: return@mapNotNull null
            NoticeRevision(id, key.substringAfter(':'))
        }
    }

    override fun known(item: NoticeRevision): Boolean {
        if (synchronized(entries) { entries.contains(item.key) }) return true
        val key = legacyKey(item) ?: return false
        if (legacyOwnerKey == null) return false
        return synchronized(legacy) {
            legacy.getString(legacyOwnerKey, null) == employeeId && legacy.getBoolean(key, false)
        }
    }

    override fun enqueue(item: NoticeRevision): Boolean = synchronized(entries) {
        val previous = entries.getInt(item.key, 0)
        if (previous == PENDING) return@synchronized true
        val saved = entries.edit().putInt(item.key, PENDING).commit()
        if (!saved) {
            // SharedPreferences updates its in-process map even when commit() returns false.
            val undo = entries.edit()
            if (previous == 0) undo.remove(item.key) else undo.putInt(item.key, previous)
            undo.apply()
        }
        saved
    }

    override fun defer(item: NoticeRevision) {
        synchronized(entries) { entries.edit().putInt(item.key, WAIT_FOR_REPUBLICATION).apply() }
    }

    override fun delivered(item: NoticeRevision) {
        val key = legacyKey(item)
        if (key != null && legacyOwnerKey != null && legacy.getString(legacyOwnerKey, null) == employeeId) {
            legacy.edit().remove(key).apply()
        }
        synchronized(entries) { entries.edit().remove(item.key).apply() }
    }

    companion object {
        private const val PENDING = 1
        private const val WAIT_FOR_REPUBLICATION = 2

        private fun digest(fields: JSONArray) = MessageDigest.getInstance("SHA-256").digest(fields.toString().toByteArray())
            .joinToString("") { "%02x".format(it) }

        private fun ownerKey(server: String, name: String) = "legacy_owner_${digest(JSONArray().put(server).put(name))}"

        fun bindUpgrade(context: Context, server: String, oldAccount: Pair<String, String>?) {
            val legacy = context.getSharedPreferences("vergen_read_announcements", Context.MODE_PRIVATE)
            val checkpoint = "migration_${digest(JSONArray().put(server))}"
            bindUpgrade(legacy, checkpoint, oldAccount?.let { ownerKey(server, it.first) }, oldAccount?.second)
        }

        internal fun bindUpgrade(legacy: SharedPreferences, checkpoint: String, oldOwnerKey: String?, oldId: String?) {
            synchronized(legacy) {
                if (legacy.contains(checkpoint)) return
                val write = legacy.edit().putBoolean(checkpoint, true)
                if (oldOwnerKey != null && oldId != null) write.putString(oldOwnerKey, oldId)
                if (!write.commit()) {
                    val undo = legacy.edit().remove(checkpoint)
                    if (oldOwnerKey != null) undo.remove(oldOwnerKey)
                    undo.apply()
                }
            }
        }

        fun open(context: Context, server: String, employeeId: String, oldName: String?): DeviceAnnouncementOutbox {
            val scopeId = digest(JSONArray().put(server).put(employeeId))
            val ownerKey = oldName?.let { ownerKey(server, it) }
            return DeviceAnnouncementOutbox(
                context.getSharedPreferences("vergen_notice_outbox_$scopeId", Context.MODE_PRIVATE),
                context.getSharedPreferences("vergen_read_announcements", Context.MODE_PRIVATE),
                employeeId, ownerKey,
            ) { item -> oldName?.let { digest(JSONArray().put(server).put(it).put(item.id).put(item.revision)) } }
        }
    }
}

/** Network reads/writes and their local outcomes are ordered within one employee session. */
internal class AnnouncementInbox(
    private val outbox: AnnouncementOutbox,
    private val scope: CoroutineScope,
    private val load: suspend () -> EmployeeAnnouncement?,
    private val send: suspend (NoticeRevision) -> Unit,
    private val storageDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    private val network = Mutex()
    private var sender: Job? = null
    private var syncRequested = false
    private var lastConfirmed: NoticeRevision? = null

    suspend fun current(): EmployeeAnnouncement? {
        retry()
        return network.withLock {
            val notice = load() ?: return@withLock null
            val item = notice.version()
            if (withContext(storageDispatcher) { outbox.known(item) }) {
                // Old hashes and a deferred 409 become migratable when this exact revision reappears.
                if (withContext(storageDispatcher) { outbox.enqueue(item) }) {
                    retry()
                } else {
                    try {
                        send(item)
                        withContext(storageDispatcher) { outbox.delivered(item) }
                    } catch (_: ApiError) {
                        // The original durable receipt still suppresses and retries this exact revision.
                    }
                }
                lastConfirmed = item
                null
            } else if (lastConfirmed == item) null else notice
        }
    }

    fun canShow(item: NoticeRevision) = item != lastConfirmed

    suspend fun confirm(item: NoticeRevision): Boolean {
        if (withContext(storageDispatcher) { outbox.enqueue(item) }) {
            lastConfirmed = item
            retry()
            return true
        }
        return try {
            network.withLock { send(item) }
            lastConfirmed = item
            withContext(storageDispatcher) { outbox.delivered(item) }
            true
        } catch (_: ApiError) {
            false
        }
    }

    private fun retry() {
        syncRequested = true
        if (sender?.isActive == true) return
        sender = scope.launch {
            while (isActive) {
                syncRequested = false
                val batch = withContext(storageDispatcher) { outbox.pending() }
                if (batch.isEmpty()) {
                    if (syncRequested) continue
                    return@launch
                }
                for (item in batch) {
                    try {
                        network.withLock {
                            send(item)
                            withContext(storageDispatcher) { outbox.delivered(item) }
                        }
                    } catch (e: ApiError) {
                        if (e.code != 409) return@launch
                        withContext(storageDispatcher) { outbox.defer(item) }
                    }
                }
            }
        }
    }

    fun close() {
        sender?.cancel()
        sender = null
    }
}
