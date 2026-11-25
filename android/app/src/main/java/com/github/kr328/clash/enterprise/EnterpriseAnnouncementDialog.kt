package com.github.kr328.clash.enterprise

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import android.os.SystemClock
import android.view.ViewTreeObserver
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.github.kr328.clash.BaseActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import io.github.vergen.android.enterprise.EmployeeAnnouncement
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

/** Owned only by the resumed business screen; login and DingTalk never attach here. */
internal object EnterpriseAnnouncementDialog {
    private var host: BaseActivity<*>? = null
    private var dialog: AlertDialog? = null
    private var showing: NoticeRevision? = null
    private val dialogFocus = ViewTreeObserver.OnWindowFocusChangeListener { _ ->
        host?.let(::focusChanged)
    }
    private val scope = MainScope()
    private var confirming: NoticeRevision? = null
    private var confirmation: Job? = null
    private var inbox: AnnouncementInbox? = null
    private var employee: String? = null

    private val unlock = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> poll.detach()
                Intent.ACTION_USER_PRESENT -> resumePolling()
            }
        }
    }

    private val poll = ForegroundAnnouncementPoller(
        scope = scope,
        now = SystemClock::elapsedRealtime,
        username = { EnterpriseKit.coordinator.announcementEmployeeId },
        canCheck = { host?.let(::canDisplay) == true },
        fetch = { owner -> if (employee == owner) inbox?.current() else null },
        display = { owner, notice -> host?.let { show(it, owner, notice) } },
    )

    fun endSession() {
        confirmation?.cancel()
        confirmation = null
        confirming = null
        poll.reset()
        inbox?.close()
        inbox = null
        employee = null
        dismiss()
    }

    fun resume(activity: BaseActivity<*>) {
        host?.let(::pause)
        host = activity
        ContextCompat.registerReceiver(activity, unlock, IntentFilter(Intent.ACTION_USER_PRESENT).apply {
            addAction(Intent.ACTION_SCREEN_OFF)
        }, ContextCompat.RECEIVER_NOT_EXPORTED)
        resumePolling()
    }

    fun focusChanged(activity: BaseActivity<*>) {
        if (activity !== host) return
        if (canDisplay(activity)) resumePolling() else poll.detach()
    }

    private fun resumePolling() {
        val activity = host ?: return
        val coordinator = EnterpriseKit.coordinator
        val user = coordinator.announcementEmployeeId
        if (employee != user) {
            endSession()
            employee = user
            if (user != null) {
                inbox = AnnouncementInbox(
                    DeviceAnnouncementOutbox.open(activity.applicationContext, VERGEN_SERVER_URL, user, coordinator.loginUsername), scope,
                    load = {
                        EnterpriseKit.announcementMigration.await()
                        coordinator.currentAnnouncement(user)
                    },
                    send = { coordinator.acknowledgeAnnouncement(user, it.id, it.revision) },
                )
            }
        }
        poll.attach()
    }

    fun pause(activity: BaseActivity<*>) {
        if (activity !== host) return
        host = null
        activity.unregisterReceiver(unlock)
        poll.detach()
        dismiss()
    }

    private fun canDisplay(activity: BaseActivity<*>): Boolean =
        host === activity && !activity.isFinishing && !activity.isDestroyed &&
            (activity.hasWindowFocus() || dialog?.window?.decorView?.hasWindowFocus() == true) &&
            activity.getSystemService<PowerManager>()?.isInteractive == true &&
            activity.getSystemService<KeyguardManager>()?.isKeyguardLocked == false

    private fun show(activity: BaseActivity<*>, owner: String, notice: EmployeeAnnouncement?) {
        if (!canDisplay(activity)) return
        if (notice == null) {
            dismiss()
            return
        }
        val item = notice.version()
        val account = inbox
        if (employee != owner || account == null || !account.canShow(item)) {
            dismiss()
            return
        }
        if (item == showing) return
        dismiss()
        showing = item
        dialog = MaterialAlertDialogBuilder(activity)
            .setTitle(notice.title)
            .setMessage(notice.content)
            .setCancelable(false)
            .setPositiveButton("我知道了", null)
            .create()
        dialog?.window?.decorView?.viewTreeObserver?.addOnWindowFocusChangeListener(dialogFocus)
        dialog?.show()
        dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
            isEnabled = confirming == null
            setOnClickListener { confirm(owner, account, item) }
        }
    }

    private fun confirm(owner: String, account: AnnouncementInbox, item: NoticeRevision) {
        if (confirming != null || showing != item || inbox !== account ||
            EnterpriseKit.coordinator.announcementEmployeeId != owner) return
        confirming = item
        dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = false
        confirmation = scope.launch {
            val saved = account.confirm(item)
            if (inbox !== account) return@launch
            confirming = null
            dialog?.getButton(AlertDialog.BUTTON_POSITIVE)?.isEnabled = true
            if (showing == item && saved) dismiss()
            if (!saved) host?.let {
                Toast.makeText(it, "未能保存公告确认，请重试", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun dismiss() {
        val previous = dialog
        dialog = null
        showing = null
        previous?.window?.decorView?.viewTreeObserver?.takeIf { it.isAlive }
            ?.removeOnWindowFocusChangeListener(dialogFocus)
        previous?.dismiss()
    }
}
