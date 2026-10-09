import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  clearToken,
  createUser,
  getDashboard,
  getSettings,
  hasToken,
  listUsers,
  login as apiLogin,
  patchSettings,
  setUserPassword,
  setUserStatus,
  type AdminSettings,
  type AdminUser,
  type DashboardStats,
  type SettingsPatch,
} from './api'

type Tab = 'users' | 'settings' | 'dashboard'

const TABS: [Tab, string][] = [
  ['users', '员工账号'],
  ['settings', '下发配置'],
  ['dashboard', '在线看板'],
]

export function App() {
  const [authed, setAuthed] = useState(hasToken)
  const [user, setUser] = useState<string>('')
  const [tab, setTab] = useState<Tab>('users')

  if (!authed) {
    return (
      <LoginPage
        onLogin={(username) => {
          setUser(username)
          setAuthed(true)
        }}
      />
    )
  }

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="brand-mark">N</span> VergeN 运维面板
        </div>
        <nav>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="who">{user}</span>
          <button
            className="ghost"
            onClick={() => {
              clearToken()
              setAuthed(false)
            }}
          >
            退出
          </button>
        </div>
      </header>
      <main>
        {tab === 'users' && <UsersPanel />}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'dashboard' && <DashboardPanel />}
      </main>
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const user = await apiLogin(username, password)
      onLogin(user.username)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ justifyContent: 'center' }}>
          <span className="brand-mark">N</span> VergeN 运维面板
        </div>
        <label>
          账号
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}

const timeOf = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '从未'

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const reload = async () => {
    try {
      const data = await listUsers()
      setUsers(data.users)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !newName || newPassword.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      await createUser(newName, newPassword)
      setNewName('')
      setNewPassword('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (user: AdminUser) => {
    try {
      await setUserStatus(
        user.id,
        user.status === 'active' ? 'disabled' : 'active',
      )
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const reset = async (id: number) => {
    if (resetPassword.length < 8) {
      setError('密码至少 8 位')
      return
    }
    try {
      await setUserPassword(id, resetPassword)
      setResetId(null)
      setResetPassword('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="panel">
      <form className="row-form" onSubmit={create}>
        <input
          placeholder="用户名"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          placeholder="初始密码(至少 8 位)"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
        >
          <option value="user">员工</option>
          <option value="admin">管理员</option>
        </select>
        <button type="submit" disabled={busy}>
          创建账号
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>角色</th>
            <th>状态</th>
            <th>最近在线</th>
            <th>客户端</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.id}
              className={user.status === 'disabled' ? 'off' : ''}
            >
              <td>{user.id}</td>
              <td>{user.username}</td>
              <td>{user.role === 'admin' ? '管理员' : '员工'}</td>
              <td>{user.status === 'active' ? '启用' : '已停用'}</td>
              <td title={user.last_os || ''}>
                {timeOf(user.last_seen_at)}
                {user.last_version ? ` · v${user.last_version}` : ''}
              </td>
              <td>
                {[user.last_os, user.last_version]
                  .filter(Boolean)
                  .join(' / ') || '-'}
              </td>
              <td className="actions">
                <button className="ghost" onClick={() => void toggle(user)}>
                  {user.status === 'active' ? '停用' : '启用'}
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    setResetId(resetId === user.id ? null : user.id)
                  }
                >
                  重置密码
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {resetId !== null && (
        <form
          className="row-form"
          onSubmit={(event) => {
            event.preventDefault()
            void reset(resetId)
          }}
        >
          <span>为 #{resetId} 设置新密码</span>
          <input
            type="password"
            placeholder="新密码(至少 8 位)"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
          />
          <button type="submit">确认</button>
          <button
            type="button"
            className="ghost"
            onClick={() => setResetId(null)}
          >
            取消
          </button>
        </form>
      )}
    </section>
  )
}

function SettingsPanel() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [agentId, setAgentId] = useState('')
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementContent, setAnnouncementContent] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getSettings().then((data) => {
      setSettings(data)
      setSubscriptionUrl(data.subscription_url ?? '')
      setAppKey(data.dingtalk_app_key ?? '')
      setAgentId(data.dingtalk_agent_id ?? '')
      setAnnouncementTitle(data.announcement?.title ?? '')
      setAnnouncementContent(data.announcement?.content ?? '')
    })
  }, [])

  const save = async (patch: SettingsPatch) => {
    try {
      const data = await patchSettings(patch)
      setSettings(data)
      setAppSecret('')
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  if (!settings) return <div className="muted">加载中…</div>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const patch: SettingsPatch = {
      subscription_url: subscriptionUrl,
      dingtalk_app_key: appKey,
      dingtalk_agent_id: agentId,
      managed_flags: settings.managed_flags,
      announcement:
        announcementTitle.trim() === ''
          ? null
          : { title: announcementTitle, content: announcementContent },
    }
    if (appSecret.trim() !== '') {
      patch.dingtalk_app_secret = appSecret
    }
    void save(patch)
  }

  return (
    <section className="panel narrow">
      <form onSubmit={submit} className="stack">
        <label>
          公司订阅地址(员工端自动导入)
          <input
            placeholder="https://…"
            value={subscriptionUrl}
            onChange={(e) => setSubscriptionUrl(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>钉钉扫码登录(客户端展示扫码入口)</legend>
          <label>
            AppKey(client_id)
            <input value={appKey} onChange={(e) => setAppKey(e.target.value)} />
          </label>
          <label>
            AppSecret
            <input
              type="password"
              placeholder={
                settings.dingtalk_app_secret_set
                  ? '已配置,留空保持不变'
                  : '未配置'
              }
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
            />
          </label>
          <label>
            AgentId(可选)
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>受管策略</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.managed_flags.allow_change_settings}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  managed_flags: {
                    ...settings.managed_flags,
                    allow_change_settings: e.target.checked,
                  },
                })
              }
            />
            允许员工修改客户端设置
          </label>
        </fieldset>
        <fieldset>
          <legend>登录页公告</legend>
          <label>
            标题(留空清除)
            <input
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
            />
          </label>
          <label>
            内容
            <textarea
              rows={3}
              value={announcementContent}
              onChange={(e) => setAnnouncementContent(e.target.value)}
            />
          </label>
        </fieldset>
        <div className="row-form">
          <button type="submit">保存全部</button>
          {message && <span className="muted">{message}</span>}
        </div>
      </form>
    </section>
  )
}

function DashboardPanel() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    const load = () => void getDashboard().then(setStats)
    load()
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [])

  if (!stats) return <div className="muted">加载中…</div>

  const cards: [string, string | number][] = [
    ['总账号', stats.total_users],
    ['在线(5 分钟内)', stats.online],
    ['24h 活跃', stats.active_24h],
    ['已停用', stats.disabled_users],
  ]

  return (
    <section className="panel">
      <div className="cards">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="card-value">{value}</div>
            <div className="card-label">{label}</div>
          </div>
        ))}
      </div>
      <div className="two-col">
        <DistTable title="版本分布" data={stats.version_distribution} />
        <DistTable title="操作系统分布" data={stats.os_distribution} />
      </div>
    </section>
  )
}

function DistTable({
  title,
  data,
}: {
  title: string
  data: Record<string, number>
}) {
  const rows = Object.entries(data)
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="muted">暂无数据</div>
      ) : (
        <table>
          <tbody>
            {rows.map(([key, count]) => (
              <tr key={key}>
                <td>{key}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
