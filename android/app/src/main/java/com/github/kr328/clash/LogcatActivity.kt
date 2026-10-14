package com.github.kr328.clash

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.net.Uri
import android.os.IBinder
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import com.github.kr328.clash.common.compat.startForegroundServiceCompat
import com.github.kr328.clash.common.log.Log
import com.github.kr328.clash.common.util.fileName
import com.github.kr328.clash.common.util.intent
import com.github.kr328.clash.common.util.ticker
import com.github.kr328.clash.core.model.LogMessage
import com.github.kr328.clash.design.LogcatDesign
import com.github.kr328.clash.design.dialog.withModelProgressBar
import com.github.kr328.clash.design.model.LogFile
import com.github.kr328.clash.design.ui.ToastDuration
import com.github.kr328.clash.design.util.showExceptionToast
import com.github.kr328.clash.enterprise.EnterpriseKit
import com.github.kr328.clash.log.LogcatFilter
import com.github.kr328.clash.log.LogcatReader
import com.github.kr328.clash.log.ManagedLogLabel
import com.github.kr328.clash.util.logsDir
import com.github.kr328.clash.util.withClash
import com.github.kr328.clash.util.withProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withContext
import java.io.OutputStreamWriter
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import com.github.kr328.clash.design.R

class LogcatActivity : BaseActivity<LogcatDesign>() {
    private var conn: ServiceConnection? = null

    override suspend fun main() {
        val fileName = intent?.fileName

        if (fileName != null) {
            val file = LogFile.parseFromFileName(fileName) ?: return showInvalid()

            return mainLocalFile(file)
        }

        return mainStreaming()
    }

    private suspend fun mainLocalFile(file: LogFile) {
        val logLabel = queryManagedLogLabel()
        val messages = try {
            LogcatReader(this, file).readAll().map { logLabel?.format(it) ?: it }
        } catch (e: Exception) {
            Log.e("Fail to read log file ${file.fileName}: ${e.message}")
            return showInvalid()
        }

        val design = LogcatDesign(this, false)

        setContentDesign(design)

        design.patchMessages(messages, 0, messages.size)

        while (isActive) {
            when (design.requests.receive()) {
                LogcatDesign.Request.Delete -> {
                    withContext(Dispatchers.IO) {
                        logsDir.resolve(file.fileName).delete()
                    }

                    finish()
                }
                LogcatDesign.Request.Export -> {
                    val output = startActivityForResult(
                        ActivityResultContracts.CreateDocument("text/plain"),
                        file.fileName
                    )

                    if (output != null) {
                        try {
                            withContext(Dispatchers.IO) {
                                writeLogTo(messages, file, output)
                            }

                            design.showToast(R.string.file_exported, ToastDuration.Long)
                        } catch (e: Exception) {
                            design.showExceptionToast(e)
                        }
                    }
                }
                else -> Unit
            }
        }
    }

    private suspend fun mainStreaming() {
        val design = LogcatDesign(this, true)

        setContentDesign(design)

        startForegroundServiceCompat(LogcatService::class.intent)

        val logcat = bindLogcatService()
        val ticker = ticker(500)

        var initial = true
        var logLabel = queryManagedLogLabel()
        var messages = emptyList<LogMessage>()

        while (isActive) {
            select<Unit> {
                events.onReceive {
                    when (it) {
                        Event.ProfileLoaded, Event.ProfileChanged, Event.ActivityStart -> {
                            val nextLabel = queryManagedLogLabel()
                            if (nextLabel != logLabel) {
                                logLabel = nextLabel
                                design.replaceMessages(messages.map { logLabel?.format(it) ?: it })
                            }
                        }
                        else -> Unit
                    }
                }
                design.requests.onReceive {
                    when (it) {
                        LogcatDesign.Request.Close -> {
                            stopService(LogcatService::class.intent)
                            startActivity(LogsActivity::class.intent)
                            finish()
                        }
                        else -> Unit
                    }
                }
                if (activityStarted) {
                    ticker.onReceive {
                        val snapshot = logcat.snapshot(initial) ?: return@onReceive

                        messages = snapshot.messages
                        design.patchMessages(
                            messages.map { logLabel?.format(it) ?: it },
                            snapshot.removed,
                            snapshot.appended
                        )

                        initial = false
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        conn?.apply(this::unbindService)

        super.onDestroy()
    }

    private suspend fun queryManagedLogLabel(): ManagedLogLabel? {
        val profileName = withProfile {
            queryActive()?.takeIf { EnterpriseKit.isManaged(it) }
                ?.name?.trim()?.takeIf { it.isNotEmpty() }
        } ?: return null
        val group = withClash {
            queryProxyGroupNames(uiStore.proxyExcludeNotSelectable).firstOrNull { it != "GLOBAL" }
        } ?: return null
        return ManagedLogLabel(group, profileName)
    }

    private suspend fun bindLogcatService(): LogcatService {
        return suspendCoroutine { ctx ->
            bindService(LogcatService::class.intent, object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                    val srv = service!!.queryLocalInterface("") as LogcatService

                    ctx.resume(srv)

                    conn = this
                }

                override fun onServiceDisconnected(name: ComponentName?) {
                    conn = null
                }
            }, Context.BIND_AUTO_CREATE)
        }
    }

    @Suppress("BlockingMethodInNonBlockingContext")
    private suspend fun writeLogTo(messages: List<LogMessage>, file: LogFile, uri: Uri) {
        LogcatFilter(OutputStreamWriter(contentResolver.openOutputStream(uri)), this).use {
            withContext(Dispatchers.Main) {
                withModelProgressBar {
                    configure {
                        isIndeterminate = true
                        max = messages.size
                    }

                    withContext(Dispatchers.IO) {
                        it.writeHeader(file.date)

                        messages.forEachIndexed { idx, msg ->
                            configure {
                                isIndeterminate = false
                                progress = idx
                            }

                            it.writeMessage(msg)
                        }
                    }
                }
            }
        }
    }

    private fun showInvalid() {
        Toast.makeText(this, R.string.invalid_log_file, Toast.LENGTH_LONG).show()
    }
}
