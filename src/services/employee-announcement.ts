import {
  flushReceipts,
  locallyConfirmed,
  ownsLegacyReceipts,
  type SendReceipt,
} from './announcement-receipts'
import type {
  AnnouncementSession,
  DeliveredAnnouncement,
  NoticeSnapshot,
} from './cmds'

/** A view renders the process-owned poll clock's snapshot. View restoration is
 * a local IPC read, not a reason to contact the announcements server. */
export function watchEmployeeAnnouncement(
  session: AnnouncementSession,
  inspect: () => Promise<NoticeSnapshot>,
  send: SendReceipt,
  display: (notice: DeliveredAnnouncement | null) => void,
) {
  ownsLegacyReceipts(session)
  let generation = 0
  let active = false
  let disposed = false
  let timer: number | undefined
  const foreground = () =>
    document.visibilityState === 'visible' && document.hasFocus()
  const refresh = async (at: number) => {
    if (disposed || !active || generation !== at || !foreground()) return
    let next = 300_000
    try {
      const snapshot = await inspect()
      if (disposed || generation !== at || !foreground()) return
      next = Math.max(1, snapshot.next_ms)
      display(
        snapshot.notice && !locallyConfirmed(session, snapshot.notice)
          ? snapshot.notice
          : null,
      )
      if (snapshot.checked)
        void flushReceipts(
          session,
          snapshot.notice,
          send,
          () => !disposed && active,
        )
    } catch {
      /* An IPC error is not an announcement withdrawal. */
    }
    if (!disposed && active && generation === at)
      timer = window.setTimeout(() => void refresh(at), next)
  }
  const pause = () => {
    if (!active) return
    generation++
    active = false
    window.clearTimeout(timer)
    display(null)
  }
  const update = () => {
    if (!foreground()) {
      pause()
      return
    }
    if (active) return
    active = true
    const at = ++generation
    // StrictMode disposes a test mount before this microtask starts.
    void Promise.resolve().then(() => refresh(at))
  }
  window.addEventListener('focus', update)
  window.addEventListener('blur', pause)
  document.addEventListener('visibilitychange', update)
  update()
  return () => {
    disposed = true
    window.clearTimeout(timer)
    window.removeEventListener('focus', update)
    window.removeEventListener('blur', pause)
    document.removeEventListener('visibilitychange', update)
  }
}
