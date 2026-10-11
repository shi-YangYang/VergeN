package com.github.kr328.clash.enterprise

import android.app.Application
import android.content.Intent
import android.os.Build
import android.os.Looper
import com.github.kr328.clash.AppCrashedActivity
import com.github.kr328.clash.common.util.intent
import java.io.File
import java.time.Instant

/**
 * Last-resort crash catcher for the anonymous launch path: without a device
 * attached we cannot read logcat, so the exception is persisted and re-launched
 * into the existing crash screen the upstream app uses. Only runs in the main
 * process (the VPN service process needs no such gate).
 */
object EnterpriseCrashGate {
    fun install(application: Application, isMainProcess: Boolean) {
        if (!isMainProcess) return
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            // The hook below suppresses the default handler (and thus the
            // AndroidRuntime FATAL logcat entry) on the main thread, so the
            // trace must be logged explicitly to stay diagnosable.
            com.github.kr328.clash.common.log.Log.e(
                "VergenCrash: uncaught on ${thread.name}",
                throwable,
            )
            runCatching {
                val dir = File(application.filesDir, "enterprise_crash").apply { mkdirs() }
                val file = File(dir, "last.txt")
                file.writeText(
                    buildString {
                        append(Instant.now())
                        append(' ')
                        append(thread.name)
                        append('\n')
                        append(throwable.stackTraceToString())
                        if (throwable.cause != null) {
                            append("\ncaused by:\n")
                            append(throwable.cause?.stackTraceToString())
                        }
                    },
                )

                if (Looper.myLooper() == Looper.getMainLooper() && isFatal(throwable)) {
                    application.startActivity(
                        AppCrashedActivity::class.intent
                            .addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK or
                                    Intent.FLAG_ACTIVITY_CLEAR_TASK,
                            ),
                    )
                    android.os.Process.killProcess(android.os.Process.myPid())
                    return@setDefaultUncaughtExceptionHandler
                }
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun isFatal(throwable: Throwable): Boolean {
        // Our handler must behave like the default one for the service
        // process; everything on the main thread here is unrecoverable.
        return Build.VERSION.SDK_INT >= 0
    }
}
