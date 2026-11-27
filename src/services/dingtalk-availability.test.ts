import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { enterpriseCapabilities } from '@/services/cmds'

import {
  cachedDingtalkEnabled,
  checkDingtalkAvailability,
  dingtalkServer,
} from './dingtalk-availability'

vi.mock('@/services/cmds', () => ({ enterpriseCapabilities: vi.fn() }))

const server = 'https://company.test'
const otherServer = 'https://company.test/other'
const request = vi.mocked(enterpriseCapabilities)
beforeEach(() => {
  vi.useFakeTimers()
  request.mockReset()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps the last confirmed value through five failures and a manual recheck can replace it', async () => {
  const done = vi.fn()
  request.mockResolvedValueOnce({ dingtalk_qr: true })
  checkDingtalkAvailability(server, done)
  await vi.runAllTimersAsync()
  expect(request).toHaveBeenCalledTimes(1)
  expect(cachedDingtalkEnabled(dingtalkServer(server + '/'))).toBe(true)
  expect(cachedDingtalkEnabled(otherServer)).toBeUndefined()

  request
    .mockRejectedValue(new Error('offline'))
    .mockResolvedValueOnce({} as never)
  request.mockResolvedValueOnce({ dingtalk_qr: 'false' } as never)
  checkDingtalkAvailability(server, done)
  await vi.runAllTimersAsync()
  expect(request).toHaveBeenCalledTimes(6)
  expect(done).toHaveBeenLastCalledWith(undefined)
  expect(cachedDingtalkEnabled(server)).toBe(true)

  request.mockResolvedValueOnce({ dingtalk_qr: false })
  checkDingtalkAvailability(server, done)
  await vi.runAllTimersAsync()
  expect(request).toHaveBeenCalledTimes(7)
  expect(cachedDingtalkEnabled(server)).toBe(false)
})

it('does not start a discarded mount or cache a late result after switching servers', async () => {
  const done = vi.fn()
  checkDingtalkAvailability(server, done)()
  let finish!: (result: { dingtalk_qr: boolean }) => void
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const stop = checkDingtalkAvailability(server, done)
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledTimes(1)
  stop()
  request.mockResolvedValueOnce({ dingtalk_qr: false })
  checkDingtalkAvailability(otherServer, done)
  finish({ dingtalk_qr: true })
  await vi.runAllTimersAsync()
  expect(done.mock.calls).toEqual([[false]])
  expect(cachedDingtalkEnabled(server)).toBeUndefined()
  expect(cachedDingtalkEnabled(otherServer)).toBe(false)
})
