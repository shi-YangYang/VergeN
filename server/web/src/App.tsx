import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  setAnnouncementEnabled,
  setSubscriptionEnabled,
  clearToken,
  createSubscription,
  createUser,
  deleteSubscription,
  getDashboard,
  getSettings,
  hasToken,
  listSubscriptions,
  listUsers,
  login as apiLogin,
  patchSettings,
  setUserDingtalk,
  setUserPassword,
  setUserStatus,
  updateAnnouncement,
  updateSubscription,
  type AdminAnnouncement,
  type AdminSettings,
  type AdminSubscription,
  type AdminUser,
  type DashboardStats,
  type SettingsPatch,
} from './api'

type Tab =
  | 'users'
  | 'subscription'
  | 'release'
  | 'dingtalk'
  | 'policy'
  | 'announcement'
  | 'dashboard'

const TABS: [Tab, string][] = [
  ['users', '员工账号'],
  ['subscription', '订阅管理'],
  ['release', '客户端发布'],
  ['dingtalk', '钉钉接入'],
  ['policy', '策略管控'],
  ['announcement', '公告管理'],
  ['dashboard', '在线看板'],
]

function alertContext(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function SubscriptionsPage() {
  const [subs, setSubs] = useState<AdminSubscription[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [error, setError] = useState('')

  const reload = async () => {
    try {
      const data = await listSubscriptions()
      setSubs(data.subscriptions)
      setError('')
    } catch (err) {
      setError(alertContext(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    try {
      await createSubscription(name.trim(), url.trim())
      setName('')
      setUrl('')
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const saveEdit = async () => {
    if (editId === null || !editUrl.trim()) return
    try {
      await updateSubscription(editId, editName.trim(), editUrl.trim())
      setEditId(null)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const toggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await setSubscriptionEnabled(id, enabled)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const remove = async (sub: AdminSubscription) => {
    if (
      sub.enabled &&
      !window.confirm('该订阅对员工可选，确认删除？员工端将立即失去该选项。')
    ) {
      return
    }
    try {
      await deleteSubscription(sub.id)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  return (
    <section className="panel">
      <form className="row-form" onSubmit={create}>
        <input
          placeholder="名称(可选)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="订阅 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button type="submit">添加订阅</button>
      </form>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>URL</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {subs.map((sub) => (
            <tr key={sub.id} className={sub.enabled ? '' : 'off'}>
              <td>{sub.id}</td>
              <td>{sub.name || '-'}</td>
              <td className="url-cell" title={sub.url}>
                {sub.url}
              </td>
              <td>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    onChange={(e) =>
                      void toggleEnabled(sub.id, e.target.checked)
                    }
                  />
                  员工可选
                </label>
              </td>
              <td className="actions">
                <button
                  className="ghost"
                  onClick={() => {
                    setEditId(editId === sub.id ? null : sub.id)
                    setEditName(sub.name)
                    setEditUrl(sub.url)
                  }}
                >
                  编辑
                </button>
                <button className="ghost" onClick={() => void remove(sub)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editId !== null && (
        <form
          className="row-form"
          onSubmit={(event) => {
            event.preventDefault()
            void saveEdit()
          }}
        >
          <span>编辑 #{editId}</span>
          <input
            placeholder="名称"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <input
            placeholder="URL"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button type="submit">确认</button>
          <button
            type="button"
            className="ghost"
            onClick={() => setEditId(null)}
          >
            取消
          </button>
        </form>
      )}
    </section>
  )
}

function PolicyPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [allowChange, setAllowChange] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getSettings().then((data) => {
      setSettings(data)
      setAllowChange(data.managed_flags.allow_change_settings)
    })
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await patchSettings({
        managed_flags: {
          allow_edit_profiles:
            settings?.managed_flags.allow_edit_profiles ?? false,
          allow_change_settings: allowChange,
        },
      })
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(alertContext(err))
    }
  }

  return (
    <section className="panel narrow">
      <form className="stack" onSubmit={save}>
        <fieldset>
          <legend>员工端限制</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={allowChange}
              onChange={(e) => setAllowChange(e.target.checked)}
            />
            允许员工修改客户端设置
          </label>
        </fieldset>
        <div className="row-form">
          <button type="submit">保存</button>
          {message && <span className="muted">{message}</span>}
        </div>
      </form>
    </section>
  )
}

function AnnouncementPage() {
  const [items, setItems] = useState<AdminAnnouncement[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState('')

  const reload = async () => {
    try {
      const data = await listAnnouncements()
      setItems(data.announcements)
      setError('')
    } catch (err) {
      setError(alertContext(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    try {
      await createAnnouncement(title.trim(), content)
      setTitle('')
      setContent('')
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const saveEdit = async () => {
    if (editId === null || !editTitle.trim()) return
    try {
      await updateAnnouncement(editId, editTitle.trim(), editContent)
      setEditId(null)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const toggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await setAnnouncementEnabled(id, enabled)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const remove = async (item: AdminAnnouncement) => {
    if (
      item.enabled &&
      !window.confirm('该公告正在下发，确认删除？员工登录页将不再显示公告。')
    ) {
      return
    }
    try {
      await deleteAnnouncement(item.id)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    }
  }

  return (
    <section className="panel">
      <form className="row-form" onSubmit={create}>
        <input
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <input
          placeholder="内容(可选)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button type="submit">添加公告</button>
      </form>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>标题</th>
            <th>内容</th>
            <th>下发</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={item.enabled ? '' : 'off'}>
              <td>{item.id}</td>
              <td>{item.title}</td>
              <td
                className="url-cell"
                title={item.content}
                style={{
                  maxWidth: 320,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.content || '-'}
              </td>
              <td>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) =>
                      void toggleEnabled(item.id, e.target.checked)
                    }
                  />
                  下发
                </label>
              </td>
              <td className="actions">
                <button
                  className="ghost"
                  onClick={() => {
                    setEditId(editId === item.id ? null : item.id)
                    setEditTitle(item.title)
                    setEditContent(item.content)
                  }}
                >
                  编辑
                </button>
                <button className="ghost" onClick={() => void remove(item)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editId !== null && (
        <form
          className="row-form"
          onSubmit={(event) => {
            event.preventDefault()
            void saveEdit()
          }}
        >
          <span>编辑 #{editId}</span>
          <input
            placeholder="标题"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <input
            placeholder="内容"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button type="submit">确认</button>
          <button
            type="button"
            className="ghost"
            onClick={() => setEditId(null)}
          >
            取消
          </button>
        </form>
      )}
    </section>
  )
}

function ReleasePage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState('')
  const [manifest, setManifest] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getSettings().then((data) => {
      setSettings(data)
      setVersion(data.release?.version ?? '')
      setNotes(data.release?.notes ?? '')
      setUrl(data.release?.url ?? '')
      setManifest(data.updater_manifest ?? '')
    })
  }, [])

  const save = async (patch: SettingsPatch) => {
    try {
      const data = await patchSettings(patch)
      setSettings(data)
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(alertContext(err))
    }
  }

  if (!settings) return <div className="muted">加载中…</div>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save({
      release:
        version.trim() === ''
          ? null
          : {
              version: version.trim(),
              notes,
              url: url.trim(),
              pub_date: 0,
            },
      updater_manifest: manifest,
    })
  }

  return (
    <section className="panel narrow">
      <form onSubmit={submit} className="stack">
        <fieldset>
          <legend>版本发布(客户端弹窗展示)</legend>
          <label>
            最新版本号(留空撤销)
            <input
              placeholder="1.0.1"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
          <label>
            更新说明
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label>
            下载地址(安装包 URL)
            <input
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          {settings.release && (
            <div className="muted" style={{ fontSize: 12 }}>
              当前已发布 v{settings.release.version}
              {settings.release.pub_date
                ? ` · ${new Date(settings.release.pub_date * 1000).toLocaleString('zh-CN')}`
                : ''}
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend>一键更新清单(可选)</legend>
          <label>
            updater JSON(tauri 格式,含签名;留空则只提示不自动升级)
            <textarea
              rows={6}
              placeholder={'{\n  "version": "1.0.1",\n  "platforms": { … }\n}'}
              value={manifest}
              onChange={(e) => setManifest(e.target.value)}
            />
          </label>
          {settings.updater_manifest && (
            <div className="muted" style={{ fontSize: 12 }}>
              一键更新已启用
            </div>
          )}
        </fieldset>
        <div className="row-form">
          <button type="submit">保存</button>
          {message && <span className="muted">{message}</span>}
        </div>
      </form>
    </section>
  )
}

function DingtalkPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [agentId, setAgentId] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void getSettings().then((data) => {
      setSettings(data)
      setAppKey(data.dingtalk_app_key ?? '')
      setAgentId(data.dingtalk_agent_id ?? '')
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
      setMessage(alertContext(err))
    }
  }

  if (!settings) return <div className="muted">加载中…</div>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const patch: SettingsPatch = {
      dingtalk_app_key: appKey,
      dingtalk_agent_id: agentId,
    }
    if (appSecret.trim() !== '') {
      patch.dingtalk_app_secret = appSecret
    }
    void save(patch)
  }

  return (
    <section className="panel narrow">
      <form onSubmit={submit} className="stack">
        <fieldset>
          <legend>钉钉扫码登录</legend>
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
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            回调地址(填入钉钉开放平台"登录与分享"Redirect URI):
            <code>{`${location.origin}/api/v1/auth/dingtalk/callback`}</code>
            <br />
            员工首次使用需在"员工账号"页为其绑定钉钉 UnionID。
          </div>
        </fieldset>
        <div className="row-form">
          <button type="submit">保存</button>
          {message && <span className="muted">{message}</span>}
        </div>
      </form>
    </section>
  )
}

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
        {tab === 'subscription' && <SubscriptionsPage />}
        {tab === 'release' && <ReleasePage />}
        {tab === 'dingtalk' && <DingtalkPage />}
        {tab === 'policy' && <PolicyPage />}
        {tab === 'announcement' && <AnnouncementPage />}
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
  const [bindId, setBindId] = useState<number | null>(null)
  const [bindDingtalk, setBindDingtalk] = useState('')

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

  const bind = async (id: number) => {
    try {
      await setUserDingtalk(id, bindDingtalk.trim())
      setBindId(null)
      setBindDingtalk('')
      setError('')
      await reload()
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
            <th>钉钉</th>
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
              <td>
                {user.dingtalk_userid ? (
                  <span
                    className="muted"
                    title={user.dingtalk_userid}
                    style={{ display: 'inline-flex', gap: 6 }}
                  >
                    {user.dingtalk_userid.slice(0, 10)}…
                  </span>
                ) : (
                  <span className="muted">未绑定</span>
                )}
              </td>
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
                <button
                  className="ghost"
                  onClick={() => {
                    setBindId(bindId === user.id ? null : user.id)
                    setBindDingtalk(user.dingtalk_userid)
                  }}
                >
                  {user.dingtalk_userid ? '重新绑定' : '绑定钉钉'}
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
      {bindId !== null && (
        <form
          className="row-form"
          onSubmit={(event) => {
            event.preventDefault()
            void bind(bindId)
          }}
        >
          <span>为 #{bindId} 绑定钉钉 UnionID</span>
          <input
            placeholder="钉钉 UnionID(留空解除绑定)"
            value={bindDingtalk}
            onChange={(e) => setBindDingtalk(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button type="submit">确认</button>
          <button
            type="button"
            className="ghost"
            onClick={() => setBindId(null)}
          >
            取消
          </button>
        </form>
      )}
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
