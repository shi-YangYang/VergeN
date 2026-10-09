const TOKEN_KEY = 'vergen_admin_token'

let token = sessionStorage.getItem(TOKEN_KEY) ?? ''

export const hasToken = () => token !== ''

export const clearToken = () => {
  token = ''
  sessionStorage.removeItem(TOKEN_KEY)
}

export interface AdminUser {
  id: number
  username: string
  role: string
  status: string
  created_at: number
  last_seen_at: number | null
  last_version: string
  last_os: string
}

export interface AdminSettings {
  subscription_url: string
  managed_flags: {
    allow_edit_profiles: boolean
    allow_change_settings: boolean
  }
  announcement: { title: string; content?: string | null } | null
  dingtalk_app_key: string
  dingtalk_app_secret_set: boolean
  dingtalk_agent_id: string
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
  options: { method?: string; body?: unknown } = {},
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
    const message = data?.error?.message ?? `请求失败 (${response.status})`
    throw new Error(message)
  }
  return data as T
}

export async function login(username: string, password: string) {
  const data = await request<{
    access_token: string
    user: { username: string; role: string }
  }>('/auth/login', { method: 'POST', body: { username, password } })
  if (data.user.role !== 'admin') {
    throw new Error('该账号不是管理员')
  }
  token = data.access_token
  sessionStorage.setItem(TOKEN_KEY, token)
  return data.user
}

export const listUsers = () => request<{ users: AdminUser[] }>('/admin/users')

export const createUser = (username: string, password: string) =>
  request<{ user: AdminUser }>('/admin/users', {
    method: 'POST',
    body: { username, password },
  })

export const setUserStatus = (id: number, status: 'active' | 'disabled') =>
  request<null>(`/admin/users/${id}/status`, {
    method: 'POST',
    body: { status },
  })

export const setUserPassword = (id: number, password: string) =>
  request<null>(`/admin/users/${id}/password`, {
    method: 'POST',
    body: { password },
  })

export const getSettings = () => request<AdminSettings>('/admin/settings')

export type SettingsPatch = Partial<{
  subscription_url: string
  managed_flags: AdminSettings['managed_flags']
  announcement: { title: string; content: string } | null
  dingtalk_app_key: string
  dingtalk_app_secret: string
  dingtalk_agent_id: string
}>

export const patchSettings = (patch: SettingsPatch) =>
  request<AdminSettings>('/admin/settings', { method: 'POST', body: patch })

export const getDashboard = () => request<DashboardStats>('/admin/dashboard')
