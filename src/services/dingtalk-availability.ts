import { enterpriseCapabilities } from '@/services/cmds'

export function dingtalkServer(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url.href.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

const key = (server: string) => `enterprise:dingtalk-enabled:${server}`

export function cachedDingtalkEnabled(server?: string): boolean | undefined {
  if (!server) return undefined
  try {
    const saved = localStorage.getItem(key(server))
    return saved === 'true' ? true : saved === 'false' ? false : undefined
  } catch {
    return undefined
  }
}

const retryDelays = [2000, 4000, 8000, 8000]

/** One cancellable round; a failed or superseded check never changes the cache. */
export function checkDingtalkAvailability(
  server: string,
  done: (enabled?: boolean) => void,
) {
  let active = true
  let retries = 0
  const check = async () => {
    let enabled: boolean | undefined
    try {
      const response = await enterpriseCapabilities(server)
      if (typeof response.dingtalk_qr === 'boolean') {
        enabled = response.dingtalk_qr
      }
    } catch {
      // A failed probe says nothing about the administrator's setting.
    }
    if (!active) return
    if (enabled !== undefined) {
      try {
        localStorage.setItem(key(server), String(enabled))
      } catch {
        // Keep the confirmed result for this login even if storage is unavailable.
      }
    } else if (retries < retryDelays.length) {
      timer = setTimeout(check, retryDelays[retries++])
      return
    }
    done(enabled)
  }
  // Cleanup can revoke a StrictMode probe before issuing an actual request.
  let timer = setTimeout(check, 0)
  return () => {
    active = false
    clearTimeout(timer)
  }
}
