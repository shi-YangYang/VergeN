import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BrowserRouter,
  Route,
  Routes,
  useMatch,
  useNavigate,
} from 'react-router-dom'

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
  createRelease,
  deleteRelease,
  listReleases,
  listPackages,
  uploadPackage,
  deletePackage,
  fetchPublicReleases,
  getDashboard,
  getSettings,
  hasToken,
  listSubscriptions,
  listUsers,
  login as apiLogin,
  patchSettings,
  setUserDingtalk,
  setUserPassword,
  deleteUser,
  updateAnnouncement,
  updateSubscription,
  type AdminAnnouncement,
  type AdminRelease,
  type AdminSettings,
  type PublicDownloads,
  type PackageFile,
  type AdminSubscription,
  type AdminUser,
  type DashboardStats,
  type SettingsPatch,
} from './api'
import { PLATFORM_GLYPHS, type PlatformKey } from './assets/platform-glyphs'

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

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="row-form" role="alert">
      <span className="error">加载失败：{error}</span>
      <button type="button" className="ghost" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}

const PLATFORM_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
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
      <div className="table-scroll">
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
      </div>
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
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await getSettings()
      setSettings(data)
      setAllowChange(data.managed_flags.allow_change_settings)
    } catch (err) {
      setError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  if (!settings) {
    return error ? (
      <LoadError error={error} onRetry={() => void load()} />
    ) : (
      <div className="muted">加载中…</div>
    )
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
      <div className="table-scroll">
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
      </div>
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

type ReleasePlatform = PackageFile['platform']

const INSTALLER_PLATFORMS: {
  key: ReleasePlatform
  label: string
  accept: string
  hint: string
}[] = [
  {
    key: 'windows',
    label: 'Windows · x64',
    accept: '.exe,.msi',
    hint: 'EXE / MSI 安装包',
  },
  {
    key: 'macos',
    label: 'macOS · Apple Silicon',
    accept: '.dmg,.pkg',
    hint: 'DMG / PKG 安装包',
  },
  {
    key: 'linux',
    label: 'Linux · x64',
    accept: '.deb,.rpm,.AppImage',
    hint: 'DEB / RPM / AppImage 安装包',
  },
  {
    key: 'android',
    label: 'Android · arm64',
    accept: '.apk',
    hint: 'APK 安装包',
  },
]

const UPDATER_TARGETS: {
  key: string
  platform: ReleasePlatform
  label: string
  accept: string
  hint: string
}[] = [
  {
    key: 'windows-x86_64',
    platform: 'windows',
    label: 'Windows',
    accept: '.exe,.msi',
    hint: '安装包及同名 .sig 文件',
  },
  {
    key: 'darwin-aarch64',
    platform: 'macos',
    label: 'macOS',
    accept: '.app.tar.gz',
    hint: '.app.tar.gz 更新包及同名 .sig 文件',
  },
  {
    key: 'linux-x86_64-deb',
    platform: 'linux',
    label: 'Linux · DEB',
    accept: '.deb',
    hint: '.deb 安装包及同名 .sig 文件',
  },
  {
    key: 'linux-x86_64-rpm',
    platform: 'linux',
    label: 'Linux · RPM',
    accept: '.rpm',
    hint: '.rpm 安装包及同名 .sig 文件',
  },
]

function acceptsPackage(name: string, accept: string) {
  return accept
    .split(',')
    .some((extension) => name.toLowerCase().endsWith(extension.toLowerCase()))
}

function PackageUpload({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string
  accept: string
  disabled: boolean
  onFile: (file: File) => void
}) {
  return (
    <label className={`package-upload${disabled ? ' disabled' : ''}`}>
      {label}
      <input
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </label>
  )
}

function ReleasePage() {
  const [releases, setReleases] = useState<AdminRelease[]>([])
  const [packages, setPackages] = useState<PackageFile[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<
    Partial<Record<ReleasePlatform, string>>
  >({})
  const [enableUpdater, setEnableUpdater] = useState(false)
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [signatures, setSignatures] = useState<
    Record<string, { name: string; text: string }>
  >({})
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState({
    name: '',
    loaded: 0,
    total: 0,
    speed: 0,
  })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const selectedPlatforms = INSTALLER_PLATFORMS.filter(
    ({ key }) => selected[key],
  )
  const availableTargets = UPDATER_TARGETS.filter(
    ({ platform }) => selected[platform],
  )
  const updaterTargets = enableUpdater
    ? availableTargets.filter(({ key }) => updates[key])
    : []
  const incompleteUpdate = updaterTargets.some(
    ({ key }) => !signatures[key]?.text,
  )
  const canPublish =
    !loading &&
    !busy &&
    version.trim() !== '' &&
    notes.trim() !== '' &&
    selectedPlatforms.length > 0 &&
    (!enableUpdater || (updaterTargets.length > 0 && !incompleteUpdate))

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [releaseData, packageData] = await Promise.all([
        listReleases(),
        listPackages(),
      ])
      setReleases(releaseData.releases)
      setPackages(packageData.packages)
    } catch (err) {
      setError(alertContext(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selectInstaller = (platform: ReleasePlatform, name: string) => {
    setSelected((value) => ({ ...value, [platform]: name }))
    setUpdates((value) => {
      const next = { ...value }
      for (const target of UPDATER_TARGETS.filter(
        (item) => item.platform === platform,
      )) {
        if (!name) delete next[target.key]
        else if (acceptsPackage(name, target.accept)) next[target.key] = name
      }
      return next
    })
    setSignatures((value) => {
      const next = { ...value }
      for (const target of UPDATER_TARGETS.filter(
        (item) => item.platform === platform,
      ))
        delete next[target.key]
      return next
    })
  }

  const upload = async (
    file: File,
    platform: ReleasePlatform,
    targetKey?: string,
  ) => {
    if (busy) return
    setError('')
    setMessage('')
    const accept = targetKey
      ? UPDATER_TARGETS.find(({ key }) => key === targetKey)!.accept
      : INSTALLER_PLATFORMS.find(({ key }) => key === platform)!.accept
    if (!acceptsPackage(file.name, accept)) {
      setError(`请选择 ${accept} 格式的文件`)
      return
    }
    if (file.size > 512 * 1024 * 1024) {
      setError('单个文件不能超过 512 MiB')
      return
    }
    setBusy('upload')
    setProgress({ name: file.name, loaded: 0, total: file.size, speed: 0 })
    const started = performance.now()
    try {
      const data = await uploadPackage(file, (loaded, total) => {
        const seconds = (performance.now() - started) / 1000
        setProgress({
          name: file.name,
          loaded,
          total,
          speed: seconds > 0 ? loaded / seconds : 0,
        })
      })
      setPackages((value) => [
        ...value.filter((item) => item.name !== data.package.name),
        data.package,
      ])
      if (targetKey) {
        setUpdates((value) => ({ ...value, [targetKey]: data.package.name }))
        setSignatures((value) => {
          const next = { ...value }
          delete next[targetKey]
          return next
        })
      } else selectInstaller(platform, data.package.name)
      setMessage(`${file.name} 已上传并选中`)
    } catch (err) {
      setError(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const readSignature = async (file: File, key: string) => {
    setError('')
    if (!file.name.endsWith('.sig') || file.size > 64 * 1024) {
      setError('请选择构建生成的 .sig 签名文件（最多 64 KiB）')
      return
    }
    if (file.name !== `${updates[key]}.sig`) {
      setError(`请选择与更新文件配套的 ${updates[key]}.sig`)
      return
    }
    try {
      const text = (await file.text()).trim()
      if (!text) throw new Error('签名文件为空，请重新选择')
      setSignatures((value) => ({ ...value, [key]: { name: file.name, text } }))
    } catch (err) {
      setError(alertContext(err))
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canPublish) return
    setBusy('publish')
    setError('')
    setMessage('')
    try {
      const updater = Object.fromEntries(
        updaterTargets.map(({ key }) => [
          key,
          {
            name: updates[key],
            signature: signatures[key].text,
          },
        ]),
      )
      const data = await createRelease({
        version: version.trim().replace(/^v/, ''),
        notes: notes.trim(),
        base_url: window.location.origin,
        packages: Object.fromEntries(
          Object.entries(selected).filter(([, name]) => name),
        ),
        updater,
      })
      setVersion('')
      setNotes('')
      setSelected({})
      setUpdates({})
      setSignatures({})
      setEnableUpdater(false)
      setMessage(
        `v${data.release.version} 已发布，下载页和客户端版本信息已更新`,
      )
      await reload()
    } catch (err) {
      setError(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const removeRelease = async (release: AdminRelease) => {
    if (
      !window.confirm(
        `删除版本 v${release.version}？该版本将从下载页移除，安装包文件仍然保留。`,
      )
    )
      return
    setBusy('delete-release')
    setError('')
    setMessage('')
    try {
      await deleteRelease(release.id)
      setMessage(`v${release.version} 已删除`)
      await reload()
    } catch (err) {
      setError(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const removePackage = async (item: PackageFile) => {
    if (
      !window.confirm(
        `删除文件 ${item.name}？已被版本或在线更新引用的文件不能删除。`,
      )
    )
      return
    setBusy('delete-package')
    setError('')
    setMessage('')
    try {
      await deletePackage(item.name)
      setPackages((value) => value.filter(({ name }) => name !== item.name))
      for (const { key } of INSTALLER_PLATFORMS)
        if (selected[key] === item.name) selectInstaller(key, '')
      setUpdates((value) =>
        Object.fromEntries(
          Object.entries(value).filter(([, name]) => name !== item.name),
        ),
      )
      setMessage(`${item.name} 已删除`)
    } catch (err) {
      setError(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="release-page stack">
      <div className="release-heading">
        <div>
          <h1>发布客户端版本</h1>
          <p className="muted">
            填写版本说明、选择安装包，再一次发布到下载页和客户端。
          </p>
        </div>
        <a href="/download" target="_blank" rel="noreferrer">
          查看下载页 ↗
        </a>
      </div>
      {error && (
        <div className="release-feedback error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="release-feedback" role="status">
          {message}
        </div>
      )}
      <form className="panel release-form stack" onSubmit={save}>
        <fieldset disabled={!!busy || loading} className="release-step">
          <legend>
            <span className="step-number">1</span> 版本信息
          </legend>
          <div className="release-version-fields">
            <label>
              版本号
              <input
                placeholder="例如 0.1.1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
              <span className="muted">
                与安装包的版本一致，每次发布使用新版本号。
              </span>
            </label>
            <label>
              更新说明
              <textarea
                rows={4}
                placeholder={
                  '这次更新了什么？\n例如：修复连接问题，优化启动速度。'
                }
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required
              />
            </label>
          </div>
        </fieldset>
        <fieldset disabled={!!busy || loading} className="release-step">
          <legend>
            <span className="step-number">2</span> 选择安装包
          </legend>
          <p className="muted">
            从 GitHub
            草稿下载后上传，或选择已有文件。只需选择本次要发布的平台，单个文件最多
            512 MiB。
          </p>
          <div className="release-package-grid">
            {INSTALLER_PLATFORMS.map((platform) => (
              <div
                className={`release-package-card${selected[platform.key] ? ' selected' : ''}`}
                key={platform.key}
              >
                <div className="release-card-heading">
                  <strong>{platform.label}</strong>
                  <span className="muted">
                    {selected[platform.key] ? '已选择' : '未选择'}
                  </span>
                </div>
                <label>
                  安装包
                  <select
                    aria-label={`${PLATFORM_LABELS[platform.key]} 安装包`}
                    value={selected[platform.key] ?? ''}
                    onChange={(event) =>
                      selectInstaller(platform.key, event.target.value)
                    }
                  >
                    <option value="">暂不发布此平台</option>
                    {packages
                      .filter(
                        (item) =>
                          item.platform === platform.key &&
                          item.kind !== 'updater' &&
                          acceptsPackage(item.name, platform.accept),
                      )
                      .map((item) => (
                        <option value={item.name} key={item.name}>
                          {item.name} · {item.size}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="release-card-footer">
                  <span className="muted">{platform.hint}</span>
                  <PackageUpload
                    label={`上传 ${PLATFORM_LABELS[platform.key]} 安装包`}
                    accept={platform.accept}
                    disabled={!!busy || loading}
                    onFile={(file) => void upload(file, platform.key)}
                  />
                </div>
              </div>
            ))}
          </div>
          {busy === 'upload' && (
            <div className="package-progress" role="status">
              <span>{progress.name}</span>
              <progress
                value={progress.loaded}
                max={progress.total || 1}
                aria-label="文件上传进度"
              />
              <span className="muted">
                {Math.floor((progress.loaded / (progress.total || 1)) * 100)}% ·{' '}
                {(progress.loaded / 1024 / 1024).toFixed(1)} /{' '}
                {(progress.total / 1024 / 1024).toFixed(1)} MiB ·{' '}
                {(progress.speed / 1024 / 1024).toFixed(2)} MiB/s
                {progress.loaded >= progress.total && ' · 正在保存文件…'}
              </span>
            </div>
          )}
        </fieldset>
        <fieldset disabled={!!busy || loading} className="release-step">
          <legend>
            <span className="step-number">3</span> 在线更新
          </legend>
          <label className="check">
            <input
              type="checkbox"
              checked={enableUpdater}
              onChange={(event) => setEnableUpdater(event.target.checked)}
            />
            同时启用桌面客户端在线更新
          </label>
          <p className="muted">
            不勾选时，客户端提示新版本，用户下载后安装。勾选后，为需要在线更新的平台选择更新包和配套签名。
          </p>
          {enableUpdater && (
            <div className="stack">
              <div className="release-update-guide">
                在 GitHub 的 Client packages 工作流勾选
                signed_updates，下载更新文件及同名 <code>.sig</code>
                。这里选择文件即可，无需填写链接或更新清单。
              </div>
              {availableTargets.length === 0 && (
                <p className="muted">
                  请先在第 2 步选择至少一个桌面平台的安装包。
                </p>
              )}
              {availableTargets.map((target) => (
                <div className="release-updater-row" key={target.key}>
                  <div>
                    <strong>{target.label}</strong>
                    <p className="muted">{target.hint}</p>
                  </div>
                  <div className="stack">
                    <label>
                      更新文件
                      <select
                        aria-label={`${target.label} 更新文件`}
                        value={updates[target.key] ?? ''}
                        onChange={(event) => {
                          const name = event.target.value
                          setUpdates((value) => ({
                            ...value,
                            [target.key]: name,
                          }))
                          setSignatures((value) => {
                            const next = { ...value }
                            delete next[target.key]
                            return next
                          })
                        }}
                      >
                        <option value="">此平台不启用在线更新</option>
                        {packages
                          .filter(
                            (item) =>
                              item.platform === target.platform &&
                              acceptsPackage(item.name, target.accept),
                          )
                          .map((item) => (
                            <option value={item.name} key={item.name}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <PackageUpload
                      label={`上传 ${target.label} 更新文件`}
                      accept={target.accept}
                      disabled={!!busy || loading}
                      onFile={(file) =>
                        void upload(file, target.platform, target.key)
                      }
                    />
                  </div>
                  <div className="release-signature">
                    <PackageUpload
                      label={`选择 ${target.label} 签名`}
                      accept=".sig"
                      disabled={!!busy || !updates[target.key]}
                      onFile={(file) => void readSignature(file, target.key)}
                    />
                    <span
                      className={
                        signatures[target.key] ? 'release-ready' : 'muted'
                      }
                    >
                      {signatures[target.key]?.name ??
                        (updates[target.key]
                          ? '还需选择配套 .sig 文件'
                          : '未启用')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="muted">
            Android 更新仍通过下载安装 APK 完成；安装包需要沿用原签名，并提高
            versionCode。
          </p>
        </fieldset>
        <div className="release-publish-bar">
          <div>
            <strong>
              {version.trim()
                ? `发布 v${version.trim().replace(/^v/, '')}`
                : '准备发布新版本'}
            </strong>
            <p className="muted">
              {selectedPlatforms.length
                ? `已选择 ${selectedPlatforms.map(({ key }) => PLATFORM_LABELS[key]).join('、')}`
                : '先填写版本说明并选择安装包'}
              {enableUpdater &&
                ` · ${updaterTargets.filter(({ key }) => signatures[key]?.text).length} 项在线更新已就绪`}
            </p>
          </div>
          <button type="submit" disabled={!canPublish}>
            {busy === 'publish' ? '正在发布…' : '发布版本'}
          </button>
        </div>
      </form>
      <section className="panel release-history">
        <div className="release-section-heading">
          <h2>已发布版本</h2>
          <span className="muted">{releases.length} 个版本</span>
        </div>
        {loading && <p className="muted">加载中…</p>}
        {!loading && releases.length === 0 && (
          <p className="muted">
            还没有发布版本。完成上方 3 步后，版本和更新说明会显示在这里。
          </p>
        )}
        {releases.map((release, index) => {
          const links = {
            windows: release.win_url,
            macos: release.mac_url,
            linux: release.linux_url,
            android: release.android_url,
          }
          return (
            <article className="release-history-item" key={release.id}>
              <div className="release-section-heading">
                <div className="row-form">
                  <strong>v{release.version}</strong>
                  {index === 0 && <span className="pill">当前版本</span>}
                  <span className="muted">
                    {new Date(release.pub_date * 1000).toLocaleString('zh-CN')}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  disabled={!!busy}
                  onClick={() => void removeRelease(release)}
                >
                  删除版本
                </button>
              </div>
              <p className="release-notes">{release.notes || '暂无更新说明'}</p>
              <div className="release-history-links">
                {INSTALLER_PLATFORMS.filter(({ key }) => links[key]).map(
                  ({ key }) => (
                    <a
                      key={key}
                      href={links[key]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {PLATFORM_LABELS[key]} ↗
                    </a>
                  ),
                )}
                <span className="muted">
                  {release.updater_platforms?.length
                    ? `在线更新：${release.updater_platforms.map((key) => UPDATER_TARGETS.find((item) => item.key === key)?.label ?? key).join('、')}`
                    : '下载后安装'}
                </span>
              </div>
            </article>
          )
        })}
      </section>
      <details className="panel release-library">
        <summary>
          文件库{' '}
          <span className="muted">
            {packages.length} 个文件 · 清理未使用的安装包和更新包
          </span>
        </summary>
        <p className="muted">
          这里管理服务器上的文件。已被版本引用的文件受到保护；请先删除对应版本，再清理文件。
        </p>
        <div className="package-table">
          <table>
            <thead>
              <tr>
                <th>文件名</th>
                <th>平台 / 用途</th>
                <th>大小</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((item) => (
                <tr key={item.name}>
                  <td>
                    <a
                      href={`/files/${encodeURIComponent(item.name)}`}
                      download
                    >
                      {item.name}
                    </a>
                  </td>
                  <td>
                    {PLATFORM_LABELS[item.platform]} ·{' '}
                    {item.kind === 'updater' ? '更新包' : '安装包'}
                  </td>
                  <td>{item.size}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      disabled={!!busy}
                      onClick={() => void removePackage(item)}
                    >
                      删除文件
                    </button>
                  </td>
                </tr>
              ))}
              {!packages.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    暂无文件，请在第 2 步上传安装包。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function DingtalkPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [agentId, setAgentId] = useState('')
  const [corpId, setCorpId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await getSettings()
      setSettings(data)
      setAppKey(data.dingtalk_app_key ?? '')
      setAgentId(data.dingtalk_agent_id ?? '')
      setCorpId(data.dingtalk_corp_id ?? '')
    } catch (err) {
      setError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  if (!settings) {
    return error ? (
      <LoadError error={error} onRetry={() => void load()} />
    ) : (
      <div className="muted">加载中…</div>
    )
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const patch: SettingsPatch = {
      dingtalk_app_key: appKey,
      dingtalk_agent_id: agentId,
      dingtalk_corp_id: corpId.trim(),
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
          <label>
            企业 CorpId(可选)
            <input
              placeholder="留空则不校验扫码组织"
              value={corpId}
              onChange={(e) => setCorpId(e.target.value)}
            />
          </label>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            配置 CorpId 后，员工必须使用公司组织成员的钉钉账号扫码才能登录；
            CorpId 可在钉钉管理后台"企业信息"页查看。
          </div>
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

function GatewayPage() {
  const navigate = useNavigate()
  return (
    <div className="login-wrap">
      <div className="gateway-card">
        <div className="brand" style={{ justifyContent: 'center' }}>
          <span className="brand-mark">N</span> VergeN
        </div>
        <button className="gateway-btn" onClick={() => navigate('/login')}>
          管理员登录
        </button>
        <button
          className="gateway-btn ghost"
          onClick={() => navigate('/download')}
        >
          下载客户端
        </button>
      </div>
    </div>
  )
}

function DownloadPage({ onBack }: { onBack: () => void }) {
  const [downloads, setDownloads] = useState<PublicDownloads | null>(null)
  const [error, setError] = useState('')
  const releases = downloads?.releases ?? null
  const publishedPaths = new Set(
    (releases ?? []).flatMap((release) =>
      [
        release.win_url,
        release.mac_url,
        release.linux_url,
        release.android_url,
      ].map((url) => {
        try {
          return new URL(url, window.location.origin).pathname
        } catch {
          return ''
        }
      }),
    ),
  )
  const packages = (downloads?.packages ?? []).filter(
    (file) => !publishedPaths.has(`/files/${encodeURIComponent(file.name)}`),
  )

  const load = useCallback(async () => {
    setError('')
    try {
      setDownloads(await fetchPublicReleases())
    } catch (err) {
      setError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="download-wrap">
      <div className="download-hero">
        <div className="brand" style={{ justifyContent: 'center' }}>
          <span className="brand-mark">N</span> VergeN 客户端
        </div>
      </div>

      {error ? (
        <LoadError error={error} onRetry={() => void load()} />
      ) : releases === null ? (
        <div className="muted" style={{ textAlign: 'center', padding: 32 }}>
          加载中…
        </div>
      ) : releases.length === 0 && packages.length === 0 ? (
        <div className="download-empty">
          <div style={{ fontSize: 40 }}>📦</div>
          管理员尚未发布客户端,敬请期待。
        </div>
      ) : (
        releases.map((release, index) => (
          <div className="download-version" key={release.id}>
            <div className="download-version-head">
              <div>
                <span className="pill">{index === 0 ? '最新' : '历史'}</span>
                <strong style={{ fontSize: 19 }}>v{release.version}</strong>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                {release.pub_date
                  ? new Date(release.pub_date * 1000).toLocaleDateString(
                      'zh-CN',
                    )
                  : ''}
              </span>
            </div>
            {release.notes && (
              <div
                className="muted"
                style={{ marginBottom: 12, whiteSpace: 'pre-line' }}
              >
                {release.notes}
              </div>
            )}
            <div className="download-grid">
              {(
                [
                  ['windows', 'Windows', release.win_url],
                  ['macos', 'macOS', release.mac_url],
                  ['linux', 'Linux', release.linux_url],
                  ['android', 'Android', release.android_url],
                ] as const
              ).map(([key, label, url]) => (
                <PlatformCard key={key} kind={key} label={label} url={url} />
              ))}
            </div>
          </div>
        ))
      )}
      {packages.length > 0 && (
        <details className="download-version download-legacy">
          <summary>
            其他安装包 <span className="muted">尚未归入版本的文件</span>
          </summary>
          <div
            className="download-grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
          >
            {packages.map((file) => (
              <PlatformCard
                key={file.name}
                kind={file.platform}
                label={PLATFORM_LABELS[file.platform]}
                url={`/files/${encodeURIComponent(file.name)}`}
                fileName={file.name}
                size={file.size}
              />
            ))}
          </div>
        </details>
      )}
      <button className="ghost" onClick={onBack} style={{ marginTop: 12 }}>
        返回
      </button>
    </div>
  )
}

function PlatformCard({
  kind,
  label,
  url,
  fileName,
  size,
}: {
  kind: PlatformKey
  label: string
  url: string
  fileName?: string
  size?: string
}) {
  const glyph = PLATFORM_GLYPHS[kind]
  const disabled = !url
  return (
    <a
      className={`platform-card${disabled ? ' platform-card-disabled' : ''}`}
      href={disabled ? undefined : url}
      target="_blank"
      rel="noreferrer"
      aria-disabled={disabled}
    >
      <svg viewBox={glyph.viewbox} width="34" height="34" aria-hidden>
        {glyph.paths.map((path) => (
          <path key={path.slice(0, 14)} d={path} fill={glyph.color} />
        ))}
      </svg>
      <span>{label}</span>
      {fileName && (
        <span
          style={{
            fontSize: 12,
            overflowWrap: 'anywhere',
            textAlign: 'center',
          }}
        >
          {fileName}
        </span>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        {disabled ? '暂无安装包' : size ? `下载 · ${size}` : '下载'}
      </span>
    </a>
  )
}

function LoginPage({
  onLogin,
  onBack,
}: {
  onLogin: (username: string) => void
  onBack?: () => void
}) {
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
        {onBack && (
          <button
            type="button"
            className="ghost"
            onClick={onBack}
            style={{ marginTop: 8 }}
          >
            返回
          </button>
        )}
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
    if (busy) return
    if (!newName.trim()) {
      setError('请输入用户名')
      return
    }
    if (newPassword.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      await createUser(newName.trim(), newPassword, newRole)
      setNewName('')
      setNewPassword('')
      setNewRole('user')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number, username: string) => {
    if (!window.confirm(`删除账号「${username}」后不可恢复,继续?`)) {
      return
    }
    try {
      await deleteUser(id)
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
          aria-label="账号角色"
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
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>钉钉</th>
              <th>角色</th>
              <th>最近在线</th>
              <th>客户端</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
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
                  <button
                    className="ghost"
                    onClick={() => void remove(user.id, user.username)}
                  >
                    删除
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
      </div>
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
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setStats(await getDashboard())
      setError('')
    } catch (err) {
      setError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  if (!stats) {
    return error ? (
      <LoadError error={error} onRetry={() => void load()} />
    ) : (
      <div className="muted">加载中…</div>
    )
  }

  const cards: [string, string | number][] = [
    ['总账号', stats.total_users],
    ['在线(5 分钟内)', stats.online],
    ['24h 活跃', stats.active_24h],
  ]

  return (
    <section className="panel">
      {error && <LoadError error={error} onRetry={() => void load()} />}
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

export function App() {
  return (
    <BrowserRouter>
      <RouterShell />
    </BrowserRouter>
  )
}

function RouterShell() {
  const navigate = useNavigate()
  const downloadMatch = useMatch('/download')
  const [authed, setAuthed] = useState(hasToken)
  const [user, setUser] = useState<string>('')
  const [tab, setTab] = useState<Tab>('users')

  if (downloadMatch) {
    return <DownloadPage onBack={() => navigate('/')} />
  }

  if (!authed) {
    return (
      <Routes>
        <Route path="/" element={<GatewayPage />} />
        <Route
          path="/login"
          element={
            <LoginPage
              onLogin={(username) => {
                setUser(username)
                setAuthed(true)
                navigate('/', { replace: true })
              }}
            />
          }
        />
        <Route path="*" element={<GatewayPage />} />
      </Routes>
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
              setUser('')
              setAuthed(false)
              navigate('/', { replace: true })
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
