import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  confirmAnnouncement,
  flushReceipts,
  locallyConfirmed,
} from './announcement-receipts'
import { watchEmployeeAnnouncement } from './employee-announcement'

const s = {
  server: 'https://ops.test/',
  username: 'alice',
  account: '101',
  epoch: 1,
}
const notice = {
  id: 1,
  revision: 'a'.repeat(64),
  title: 'Notice',
  content: 'Content',
}
let focus = true
let storage: Map<string, string>
beforeEach(() => {
  focus = true
  vi.useFakeTimers()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    get length() {
      return storage.size
    },
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { setTimeout, clearTimeout }),
  )
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      hasFocus: () => focus,
    }),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('skips the disposed StrictMode mount, coalesces focus notices and releases its timer', async () => {
  const inspect = vi
    .fn()
    .mockResolvedValue({ notice, next_ms: 180000, checked: false })
  const send = vi.fn()
  const show = vi.fn()
  const start = () => watchEmployeeAnnouncement(s, inspect, send, show)
  start()()
  const stop = start()
  await vi.advanceTimersByTimeAsync(0)
  expect(inspect).toHaveBeenCalledTimes(1)
  focus = false
  window.dispatchEvent(new Event('blur'))
  expect(show).toHaveBeenLastCalledWith(null)
  await vi.advanceTimersByTimeAsync(600000)
  expect(inspect).toHaveBeenCalledTimes(1)
  focus = true
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(inspect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(179999)
  expect(inspect).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(inspect).toHaveBeenCalledTimes(3)
  stop()
  expect(vi.getTimerCount()).toBe(0)
})
it('sends offline confirmations under the same stable account only and then removes local history', async () => {
  const offline = vi.fn().mockRejectedValue(new Error('offline'))
  const hide = vi.fn()
  await confirmAnnouncement(s, notice, offline, hide)
  expect(hide).toHaveBeenCalledTimes(1)
  expect(locallyConfirmed(s, notice)).toBe(true)
  const saved = vi.fn().mockResolvedValue('saved')
  await flushReceipts({ ...s, account: '202' }, null, saved, () => true)
  expect(saved).not.toHaveBeenCalled()
  await flushReceipts(s, null, saved, () => true)
  expect(saved).toHaveBeenCalledWith(1, notice.revision)
  expect(
    [...storage.keys()].filter(
      (k) =>
        k.startsWith('vergen:announcement:pending:') ||
        k.startsWith('vergen:announcement:read:'),
    ),
  ).toHaveLength(0)
})
it('reconciles a matched legacy key, and defers unknown revisions without blocking later ones', async () => {
  const legacy =
    'vergen:announcement:read:' +
    JSON.stringify(['https://ops.test', 'alice', 1, notice.revision])
  storage.set(legacy, '1')
  const unknown = vi.fn().mockResolvedValue('unknown_revision')
  expect(locallyConfirmed(s, notice)).toBe(true)
  await flushReceipts(s, notice, unknown, () => true)
  const saved = vi.fn().mockResolvedValue('saved')
  await flushReceipts(s, null, saved, () => true)
  expect(saved).not.toHaveBeenCalled()
  const other = { ...notice, id: 2 }
  await confirmAnnouncement(
    s,
    other,
    vi.fn().mockRejectedValue('offline'),
    () => {},
  )
  await flushReceipts(s, null, saved, () => true)
  expect(saved).toHaveBeenCalledTimes(1)
  await flushReceipts(s, notice, saved, () => true)
  expect(
    [...storage.keys()].filter(
      (k) =>
        k.startsWith('vergen:announcement:pending:') ||
        k.startsWith('vergen:announcement:read:'),
    ),
  ).toHaveLength(0)
})
it('does not claim durable acknowledgement when both storage and the server fail', async () => {
  vi.stubGlobal('localStorage', {
    setItem() {
      throw new Error('storage full')
    },
  })
  const hide = vi.fn()
  await expect(
    confirmAnnouncement(
      s,
      notice,
      vi.fn().mockRejectedValue(new Error('offline')),
      hide,
    ),
  ).rejects.toThrow()
  expect(hide).not.toHaveBeenCalled()
})

it('binds ambiguous legacy receipts only to the restored employee and never removes them for a reused username', async () => {
  const legacy =
    'vergen:announcement:read:' +
    JSON.stringify(['https://ops.test', 'alice', 1, notice.revision])
  const newUser = { ...s, account: '202', epoch: 3 }
  storage.set(legacy, '1')
  expect(locallyConfirmed(s, notice)).toBe(true)
  expect(locallyConfirmed(newUser, notice)).toBe(false)
  const saved = vi.fn().mockResolvedValue('saved')
  await flushReceipts(newUser, notice, saved, () => true)
  expect(saved).not.toHaveBeenCalled()
  await confirmAnnouncement(newUser, notice, saved, () => {})
  expect(storage.get(legacy)).toBe('1')
  storage.clear()
  storage.set(legacy, '1')
  expect(locallyConfirmed(newUser, notice)).toBe(false)
  expect(locallyConfirmed({ ...newUser, epoch: 1 }, notice)).toBe(false)
})
