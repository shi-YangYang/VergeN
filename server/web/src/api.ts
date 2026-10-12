const TOKEN_KEY = 'vergen_admin_token'
const REFRESH_KEY = 'vergen_admin_refresh'

let token = sessionStorage.getItem(TOKEN_KEY) ?? ''
let refreshToken = sessionStorage.getItem(REFRESH_KEY) ?? ''

export const hasToken = () => token !== ''

export const clearToken = () => {
  token = ''
  refreshToken = ''
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

// Access tokens live 30 minutes; a single in-flight refresh shared by all
// concurrent 401s keeps the operator signed in instead of forcing a
// re-login whenever the page lingers.
let refreshing: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (!response.ok) return false
        const data = await response.json()
        token = data.access_token
        if (data.refresh_token) refreshToken = data.refresh_token
        sessionStorage.setItem(TOKEN_KEY, token)
        sessionStorage.setItem(REFRESH_KEY, refreshToken)
        return true
      } catch {
        return false
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

export interface AdminUser {
  id: number
  username: string
  dingtalk_userid: string
  role: string
  status: string
  created_at: number
  last_seen_at: number | null
  last_version: string
  last_os: string
}

export interface AdminSettings {
  managed_flags: {
    allow_edit_profiles: boolean
    allow_change_settings: boolean
  }
  updater_manifest: string
  dingtalk_app_key: string
  dingtalk_app_secret_set: boolean
  dingtalk_agent_id: string
  dingtalk_corp_id: string
}

export interface AdminAnnouncement {
  id: number
  title: string
  content: string
  enabled: boolean
  created_at: number
  updated_at: number
}

export async function listAnnouncements() {
  return request<{ announcements: AdminAnnouncement[] }>('/admin/announcements')
}

export async function createAnnouncement(title: string, content: string) {
  return request<{ announcement: AdminAnnouncement }>('/admin/announcements', {
    method: 'POST',
    body: { title, content },
  })
}

export async function updateAnnouncement(
  id: number,
  title: string,
  content: string,
) {
  return request<null>(`/admin/announcements/${id}`, {
    method: 'POST',
    body: { title, content },
  })
}

export async function setAnnouncementEnabled(id: number, enabled: boolean) {
  return request<null>(`/admin/announcements/${id}/enable`, {
    method: 'POST',
    body: { enabled },
  })
}

export async function deleteAnnouncement(id: number) {
  return request<null>(`/admin/announcements/${id}`, { method: 'DELETE' })
}

export interface DashboardStats {
  total_users: number
  disabled_users: number
  online: number
  active_24h: number
  online_window_seconds: number
  version_distribution: Record<string, number>
  os_distribution: Record<string, number>
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; retried?: boolean } = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    if (
      response.status === 401 &&
      !options.retried &&
      data?.error?.code === 'invalid_access_token'
    ) {
      if (await refreshAccessToken()) {
        return request<T>(path, { ...options, retried: true })
      }
      // The refresh token died too: drop the stale identity so the next
      // view lands on the login card instead of failing forever.
      clearToken()
      location.reload()
    }
    const message = data?.error?.message ?? `请求失败 (${response.status})`
    throw new Error(message)
  }
  return data as T
}

export async function login(username: string, password: string) {
  const data = await request<{
    access_token: string
    refresh_token?: string
    user: { username: string; role: string }
  }>('/auth/login', { method: 'POST', body: { username, password } })
  if (data.user.role !== 'admin') {
    throw new Error('该账号不是管理员')
  }
  token = data.access_token
  sessionStorage.setItem(TOKEN_KEY, token)
  if (data.refresh_token) {
    refreshToken = data.refresh_token
    sessionStorage.setItem(REFRESH_KEY, refreshToken)
  }
  return data.user
}

export const listUsers = () => request<{ users: AdminUser[] }>('/admin/users')

export const createUser = (username: string, password: string) =>
  request<{ user: AdminUser }>('/admin/users', {
    method: 'POST',
    body: { username, password },
  })

export const deleteUser = (id: number) =>
  request<null>(`/admin/users/${id}`, {
    method: 'DELETE',
  })

export const setUserPassword = (id: number, password: string) =>
  request<null>(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password },
  })

export const setUserDingtalk = (id: number, dingtalkUserid: string) =>
  request<null>(`/admin/users/${id}/dingtalk`, {
    method: 'POST',
    body: { dingtalk_userid: dingtalkUserid },
  })

export interface AdminSubscription {
  id: number
  name: string
  url: string
  enabled: boolean
  created_at: number
}

export async function listSubscriptions() {
  return request<{ subscriptions: AdminSubscription[] }>('/admin/subscriptions')
}

export async function createSubscription(name: string, url: string) {
  return request<{ subscription: AdminSubscription }>('/admin/subscriptions', {
    method: 'POST',
    body: { name, url },
  })
}

export async function updateSubscription(
  id: number,
  name: string,
  url: string,
) {
  return request<null>(`/admin/subscriptions/${id}`, {
    method: 'POST',
    body: { name, url },
  })
}

export async function setSubscriptionEnabled(id: number, enabled: boolean) {
  return request<null>(`/admin/subscriptions/${id}/enable`, {
    method: 'POST',
    body: { enabled },
  })
}

export async function deleteSubscription(id: number) {
  return request<null>(`/admin/subscriptions/${id}`, { method: 'DELETE' })
}

export const getSettings = () => request<AdminSettings>('/admin/settings')

export type SettingsPatch = Partial<{
  managed_flags: AdminSettings['managed_flags']
  updater_manifest: string
  dingtalk_app_key: string
  dingtalk_app_secret: string
  dingtalk_agent_id: string
  dingtalk_corp_id: string
}>

export const patchSettings = (patch: SettingsPatch) =>
  request<AdminSettings>('/admin/settings', { method: 'POST', body: patch })

export const getDashboard = () => request<DashboardStats>('/admin/dashboard')

export interface AdminRelease {
  id: number
  version: string
  notes: string
  win_url: string
  linux_url: string
  mac_url: string
  android_url: string
  pub_date: number
  created_at: number
}

export const listReleases = () =>
  request<{ releases: AdminRelease[] }>('/admin/releases')

export async function createRelease(payload: {
  version: string
  notes: string
  win_url?: string
  linux_url?: string
  mac_url?: string
  android_url?: string
}) {
  return request<{ release: AdminRelease }>('/admin/releases', {
    method: 'POST',
    body: payload,
  })
}

export async function deleteRelease(id: number) {
  return request<null>(`/admin/releases/${id}`, { method: 'DELETE' })
}

// Gateway download page: intentionally unauthenticated.
export interface PublicRelease {
  id: number
  version: string
  notes: string
  win_url: string
  linux_url: string
  mac_url: string
  android_url: string
  pub_date: number
  created_at: number
}

export async function fetchPublicReleases(): Promise<PublicRelease[]> {
  try {
    const response = await fetch('/api/v1/public/releases')
    if (!response.ok) return []
    const data = (await response.json()) as { releases: PublicRelease[] }
    return data.releases ?? []
  } catch {
    return []
  }
}
