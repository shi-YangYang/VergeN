package com.github.kr328.clash.enterprise

import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.EmployeeAnnouncement
import io.github.vergen.android.enterprise.ErrorKind
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Main-thread state for one signed-in session, not one Activity. */
internal class ForegroundAnnouncementPoller(
    private val scope: CoroutineScope,
    private val now: () -> Long,
    private val username: () -> String?,
    private val canCheck: () -> Boolean,
    private val fetch: suspend (String) -> EmployeeAnnouncement?,
    private val display: (String, EmployeeAnnouncement?) -> Unit,
) {
    private var owner: String? = null
    private var current: EmployeeAnnouncement? = null
    private var timer: Job? = null
    private var request: Job? = null
    private var remaining = POLL_INTERVAL_MS
    private var deadline = 0L
    private var started = false

    fun attach() {
        val employee = username()
        if (owner != employee) reset()
        if (employee == null || !canCheck()) {
            detach()
            return
        }
        owner = employee
        if (timer != null) return
        deadline = now() + remaining
        timer = scope.launch {
            while (isActive) {
                delay((deadline - now()).coerceAtLeast(0L))
                if (username() != employee) return@launch reset()
                if (!canCheck()) return@launch detach()
                deadline = now() + POLL_INTERVAL_MS
                check(employee)
            }
        }
        if (!started) {
            started = true
            check(employee)
        } else {
            display(employee, current)
        }
    }

    private fun check(employee: String) {
        if (request?.isActive == true) return
        request = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            val result = try {
                fetch(employee)
            } catch (e: ApiError) {
                if (e.kind != ErrorKind.FORBIDDEN) return@launch
                null
            }
            if (!isActive || owner != employee || username() != employee) return@launch
            current = result
            if (timer != null && canCheck()) display(employee, current)
        }
    }

    fun detach() {
        if (timer == null) return
        timer?.cancel()
        timer = null
        remaining = (deadline - now()).takeIf { it > 0L } ?: POLL_INTERVAL_MS
    }

    fun reset() {
        detach()
        request?.cancel()
        request = null
        owner?.let { display(it, null) }
        owner = null
        current = null
        started = false
        remaining = POLL_INTERVAL_MS
    }

    private companion object {
        const val POLL_INTERVAL_MS = 5 * 60_000L
    }
}
