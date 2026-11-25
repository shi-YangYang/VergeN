const TOKEN_KEY = 'vergen_admin_token'
const REFRESH_KEY = 'vergen_admin_refresh'
// A cross-tab change notification and startup hint, never a credential.
const DEVICE_KEY = 'vergen_admin_device_session'

let token = sessionStorage.getItem(TOKEN_KEY) ?? ''
let refreshToken = sessionStorage.getItem(REFRESH_KEY) ?? ''
let rememberedUser: number | null = null
let generation = 0

export const adminToken = () => token
export const hasToken = () => Boolean(token)

export function mayRestoreDevice() {
  try {
    return localStorage.getItem(DEVICE_KEY) !== null
  } catch {
    return true
  }
}

function markDevice(remember: boolean) {
  try {
    if (remember) localStorage.setItem(DEVICE_KEY, String(Date.now()))
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Browsers that disallow local storage can still restore an HttpOnly cookie.
  }
}

export function watchDeviceChanges() {
  const handle = (event: StorageEvent) => {
    if (event.key === DEVICE_KEY && (!token || rememberedUser !== null)) {
      location.reload()
    }
  }
  window.addEventListener('storage', handle)
  return () => window.removeEventListener('storage', handle)
}

function clearTokens() {
  generation++
  token = ''
  refreshToken = ''
  rememberedUser = null
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

type Session = {
  access_token: string
  refresh_token?: string
  user: { id: number; username: string }
}

function accept(session: Session) {
  token = session.access_token
  refreshToken = session.refresh_token ?? ''
  if (refreshToken) {
    rememberedUser = null
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(REFRESH_KEY, refreshToken)
  } else {
    rememberedUser = session.user.id
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
  }
}

const post = (action: string, body: unknown = {}) =>
  fetch('/api/v1/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

let refreshing: Promise<boolean> | null = null

export function refreshAdminAccess(): Promise<boolean> {
  if (!refreshing) {
    const current = generation
    refreshing = (async () => {
      const response = refreshToken
        ? await post('auth/refresh', { refresh_token: refreshToken })
        : await post('admin/session/restore')
      if (current !== generation) throw new Error('登录状态已改变，请重试')
      if (response.status === 401 || response.status === 403) {
        if (!refreshToken) markDevice(false)
        return false
      }
      if (!response.ok) throw new Error('恢复登录失败，请稍后重试')
      const data: Session = await response.json()
      if (current !== generation) throw new Error('登录状态已改变，请重试')
      // Never retry an action from an old tab under a different administrator.
      if (rememberedUser !== null && rememberedUser !== data.user.id)
        return false
      accept(data)
      return true
    })().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

export function expireAdminSession() {
  clearTokens()
  location.reload()
}

export async function login(
  username: string,
  password: string,
  remember: boolean,
) {
  const response = await post('admin/session/login', {
    username,
    password,
    remember,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error?.message ?? '登录失败')
  clearTokens()
  accept(data)
  markDevice(remember)
  return data.user as Session['user']
}

export async function logout() {
  // A tab-only login must not revoke another tab's remembered administrator.
  const device = !refreshToken
  const response = device
    ? await post('admin/session/logout')
    : await post('auth/logout', { refresh_token: refreshToken })
  if (!response.ok) throw new Error('退出登录失败，请重试')
  clearTokens()
  if (device) markDevice(false)
}
