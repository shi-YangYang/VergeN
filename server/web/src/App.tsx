import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined'
import AppsRounded from '@mui/icons-material/AppsRounded'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import InsertChartOutlined from '@mui/icons-material/InsertChartOutlined'
import LinkRounded from '@mui/icons-material/LinkRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import MenuRounded from '@mui/icons-material/MenuRounded'
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Button from '@mui/material/Button'
import CardActionArea from '@mui/material/CardActionArea'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import OutlinedInput from '@mui/material/OutlinedInput'
import Paper from '@mui/material/Paper'
import SvgIcon from '@mui/material/SvgIcon'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BrowserRouter,
  Route,
  Routes,
  useMatch,
  useNavigate,
} from 'react-router-dom'

import mark from '../../../src/assets/image/vergen-mark.svg'

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
  downloadAdminPackage,
  uploadPackage,
  verifyPackageSignature,
  deletePackage,
  fetchDownloadReleases,
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
  type EmployeeDownloads,
  type PackageFile,
  type AdminSubscription,
  type AdminUser,
  type DashboardStats,
  type SettingsPatch,
} from './api'
import heroDarkVideo from './assets/optical-fiber-dark.mp4'
import mobileHeroDarkVideo from './assets/optical-fiber-mobile-dark.mp4'
import mobileHeroAnimation from './assets/optical-fiber-mobile.gif'
import mobileHeroVideo from './assets/optical-fiber-mobile.mp4'
import mobileHeroStill from './assets/optical-fiber-mobile.webp'
import heroAnimation from './assets/optical-fiber.gif'
import heroVideo from './assets/optical-fiber.mp4'
import heroStill from './assets/optical-fiber.webp'
import { PLATFORM_GLYPHS, type PlatformKey } from './assets/platform-glyphs'
import { IOSDownloadCard, IOSSettingsPage } from './components/IOSAccess'
import { useMessage } from './components/message-context'
import {
  MessageHelp,
  MessageNotice,
  MessageProvider,
} from './components/Messages'
import { Select } from './components/Select'
import {
  acceptsPackage,
  normalizeReleaseVersion,
  packageMatchesVersion,
} from './release-files'
import { deleteHistoricalReleases, nextReleaseVersion } from './release-history'

type Tab =
  | 'users'
  | 'subscription'
  | 'release'
  | 'ios'
  | 'dingtalk'
  | 'announcement'
  | 'dashboard'

const TABS: [Tab, string][] = [
  ['users', '员工账号'],
  ['subscription', '订阅管理'],
  ['release', '客户端发布'],
  ['ios', 'iOS 设置'],
  ['dingtalk', '钉钉接入'],
  ['announcement', '公告管理'],
  ['dashboard', '在线看板'],
]

const tabIcons = {
  users: GroupsOutlined,
  subscription: LinkRounded,
  release: CloudUploadOutlined,
  ios: PhoneIphoneRounded,
  dingtalk: ContactsOutlined,
  announcement: CampaignOutlined,
  dashboard: InsertChartOutlined,
}

function alertContext(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <>
      <MessageNotice kind="error" text={`加载失败：${error}`} />
      <Button variant="outlined" onClick={onRetry}>
        重新加载
      </Button>
    </>
  )
}

const PLATFORM_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
}

function SubscriptionsPage() {
  const [subs, setSubs] = useState<AdminSubscription[] | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const message = useMessage()

  const [loadError, setLoadError] = useState('')
  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const data = await listSubscriptions()
      setSubs(data.subscriptions ?? [])
    } catch (err) {
      setLoadError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    try {
      await createSubscription(name.trim(), url.trim())
      setName('')
      setUrl('')
      await reload()
    } catch (err) {
      message.error(alertContext(err))
    }
  }

  const saveEdit = async () => {
    if (editId === null || !editUrl.trim()) return
    try {
      await updateSubscription(editId, editName.trim(), editUrl.trim())
      setEditId(null)
      await reload()
    } catch (err) {
      message.error(alertContext(err))
    }
  }

  const toggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await setSubscriptionEnabled(id, enabled)
      await reload()
    } catch (err) {
      message.error(alertContext(err))
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
      message.error(alertContext(err))
    }
  }

  return (
    <Paper component="section" variant="outlined" className="panel">
      <form className="create-form" onSubmit={create}>
        <TextField
          label="名称(可选)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="订阅 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit">添加订阅</Button>
      </form>
      {loadError && (
        <LoadError error={loadError} onRetry={() => void reload()} />
      )}
      <div className="table-scroll">
        <Table className="mobile-cards">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>名称</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {subs?.map((sub) => (
              <TableRow key={sub.id} className={sub.enabled ? '' : 'off'}>
                <TableCell data-label="ID">{sub.id}</TableCell>
                <TableCell data-label="名称">{sub.name || '-'}</TableCell>
                <TableCell
                  data-label="URL"
                  className="url-cell"
                  title={sub.url}
                >
                  {sub.url}
                </TableCell>
                <TableCell data-label="状态">
                  <label className="check">
                    <Checkbox
                      checked={sub.enabled}
                      onChange={(e) =>
                        void toggleEnabled(sub.id, e.target.checked)
                      }
                    />
                    员工可选
                  </label>
                </TableCell>
                <TableCell data-label="操作" className="actions">
                  <div className="action-buttons">
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setEditId(editId === sub.id ? null : sub.id)
                        setEditName(sub.name)
                        setEditUrl(sub.url)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => void remove(sub)}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!subs?.length && !loadError && (
              <TableRow>
                <TableCell colSpan={5} className="empty-cell">
                  {subs ? '暂无订阅' : '加载中…'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {editId !== null && (
        <Dialog
          open
          fullWidth
          maxWidth="xs"
          aria-labelledby="edit-title"
          onClose={() => setEditId(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveEdit()
            }}
          >
            <DialogTitle id="edit-title">编辑订阅 #{editId}</DialogTitle>
            <DialogContent className="edit-fields">
              <TextField
                label="名称"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <TextField
                label="URL"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button variant="outlined" onClick={() => setEditId(null)}>
                取消
              </Button>
              <Button type="submit">确认</Button>
            </DialogActions>
          </form>
        </Dialog>
      )}
    </Paper>
  )
}

function AnnouncementPage() {
  const [items, setItems] = useState<AdminAnnouncement[] | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const message = useMessage()

  const [loadError, setLoadError] = useState('')
  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const data = await listAnnouncements()
      setItems(data.announcements ?? [])
    } catch (err) {
      setLoadError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    try {
      await createAnnouncement(title.trim(), content)
      setTitle('')
      setContent('')
      await reload()
    } catch (err) {
      message.error(alertContext(err))
    }
  }

  const saveEdit = async () => {
    if (editId === null || !editTitle.trim()) return
    try {
      await updateAnnouncement(editId, editTitle.trim(), editContent)
      setEditId(null)
      await reload()
    } catch (err) {
      message.error(alertContext(err))
    }
  }

  const toggleEnabled = async (id: number, enabled: boolean) => {
    try {
      await setAnnouncementEnabled(id, enabled)
      await reload()
    } catch (err) {
      message.error(alertContext(err))
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
      message.error(alertContext(err))
    }
  }

  return (
    <Paper component="section" variant="outlined" className="panel">
      <form className="create-form" onSubmit={create}>
        <TextField
          label="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="内容(可选)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Button type="submit">添加公告</Button>
      </form>
      {loadError && (
        <LoadError error={loadError} onRetry={() => void reload()} />
      )}
      <div className="table-scroll">
        <Table className="mobile-cards">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>标题</TableCell>
              <TableCell>内容</TableCell>
              <TableCell>下发</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items?.map((item) => (
              <TableRow key={item.id} className={item.enabled ? '' : 'off'}>
                <TableCell data-label="ID">{item.id}</TableCell>
                <TableCell data-label="标题">{item.title}</TableCell>
                <TableCell
                  data-label="内容"
                  className="url-cell announcement-content"
                  title={item.content}
                >
                  {item.content || '-'}
                </TableCell>
                <TableCell data-label="下发">
                  <label className="check">
                    <Checkbox
                      checked={item.enabled}
                      onChange={(e) =>
                        void toggleEnabled(item.id, e.target.checked)
                      }
                    />
                    下发
                  </label>
                </TableCell>
                <TableCell data-label="操作" className="actions">
                  <div className="action-buttons">
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setEditId(editId === item.id ? null : item.id)
                        setEditTitle(item.title)
                        setEditContent(item.content)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => void remove(item)}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!items?.length && !loadError && (
              <TableRow>
                <TableCell colSpan={5} className="empty-cell">
                  {items ? '暂无公告' : '加载中…'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {editId !== null && (
        <Dialog
          open
          fullWidth
          maxWidth="xs"
          aria-labelledby="edit-title"
          onClose={() => setEditId(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveEdit()
            }}
          >
            <DialogTitle id="edit-title">编辑公告 #{editId}</DialogTitle>
            <DialogContent className="edit-fields">
              <TextField
                label="标题"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <TextField
                label="内容"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button variant="outlined" onClick={() => setEditId(null)}>
                取消
              </Button>
              <Button type="submit">确认</Button>
            </DialogActions>
          </form>
        </Dialog>
      )}
    </Paper>
  )
}

type ReleasePlatform = PackageFile['platform']

const INSTALLER_PLATFORMS: {
  key: ReleasePlatform
  architecture: string
  accept: string
  hint: string
}[] = [
  {
    key: 'windows',
    architecture: 'x64',
    accept: '.exe',
    hint: 'EXE 安装包',
  },
  {
    key: 'macos',
    architecture: 'Apple Silicon',
    accept: '.dmg,.pkg',
    hint: 'DMG / PKG 安装包',
  },
  {
    key: 'linux',
    architecture: 'x64',
    accept: '.deb',
    hint: 'DEB 安装包',
  },
  {
    key: 'android',
    architecture: 'arm64',
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
    accept: '.exe',
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
]

function PackageUpload({
  label,
  platform,
  accept,
  disabled,
  onFile,
}: {
  label: string
  platform: string
  accept: string
  disabled: boolean
  onFile: (file: File) => void
}) {
  return (
    <Button
      component="label"
      role={undefined}
      variant="outlined"
      className="package-upload"
      disabled={disabled}
      startIcon={<CloudUploadOutlined />}
    >
      {label}
      <input
        type="file"
        accept={accept}
        aria-label={`${platform} ${label}`}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </Button>
  )
}

function ReleasePage() {
  const [releases, setReleases] = useState<AdminRelease[]>([])
  const [selectedHistory, setSelectedHistory] = useState<number[]>([])
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
  const message = useMessage()
  const historicalReleases = releases.slice(1)
  const selectedHistoricalReleases = historicalReleases.filter((release) =>
    selectedHistory.includes(release.id),
  )
  const currentPackages = packages.filter((item) =>
    packageMatchesVersion(item.name, version),
  )
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
      setVersion(
        (value) =>
          value ||
          nextReleaseVersion(
            releaseData.releases.map((release) => release.version),
          ),
      )
      setSelectedHistory((value) =>
        value.filter((id) =>
          releaseData.releases.slice(1).some((release) => release.id === id),
        ),
      )
    } catch (err) {
      message.error(alertContext(err))
    } finally {
      setLoading(false)
    }
  }, [message])

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

    const accept = targetKey
      ? UPDATER_TARGETS.find(({ key }) => key === targetKey)!.accept
      : INSTALLER_PLATFORMS.find(({ key }) => key === platform)!.accept
    if (!acceptsPackage(file.name, accept)) {
      message.error(`请选择 ${accept} 格式的文件`)
      return
    }
    if (!packageMatchesVersion(file.name, version)) {
      message.error(
        `请选择 v${normalizeReleaseVersion(version)} 的文件，并保留构建生成的文件名（VergeN_版本号_…）`,
      )
      return
    }
    if (file.size > 512 * 1024 * 1024) {
      message.error('单个文件不能超过 512 MiB')
      return
    }
    setBusy('upload')
    setProgress({ name: file.name, loaded: 0, total: file.size, speed: 0 })
    const started = performance.now()
    try {
      const data = await uploadPackage(
        file,
        { platform, kind: targetKey ? 'updater' : 'installer' },
        (loaded, total) => {
          const seconds = (performance.now() - started) / 1000
          setProgress({
            name: file.name,
            loaded,
            total,
            speed: seconds > 0 ? loaded / seconds : 0,
          })
        },
      )
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
      message.success(`${file.name} 已上传并选中`)
    } catch (err) {
      message.error(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const readSignature = async (file: File, key: string) => {
    if (busy) return

    setSignatures((value) => {
      const next = { ...value }
      delete next[key]
      return next
    })
    if (!file.name.endsWith('.sig') || file.size > 64 * 1024) {
      message.error('请选择构建生成的 .sig 签名文件（最多 64 KiB）')
      return
    }
    if (file.name !== `${updates[key]}.sig`) {
      message.error(`请选择与更新文件配套的 ${updates[key]}.sig`)
      return
    }
    setBusy(`verify-${key}`)
    try {
      const text = (await file.text()).trim()
      if (!text) throw new Error('签名文件为空，请重新选择')
      await verifyPackageSignature({
        target: key,
        version: normalizeReleaseVersion(version),
        name: updates[key],
        signature_name: file.name,
        signature: text,
      })
      setSignatures((value) => ({ ...value, [key]: { name: file.name, text } }))
    } catch (err) {
      message.error(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canPublish) return
    setBusy('publish')

    try {
      const updater = Object.fromEntries(
        updaterTargets.map(({ key }) => [
          key,
          {
            name: updates[key],
            signature: signatures[key].text,
            signature_name: signatures[key].name,
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
      setVersion(
        nextReleaseVersion([
          ...releases.map((release) => release.version),
          data.release.version,
        ]),
      )
      setNotes('')
      setSelected({})
      setUpdates({})
      setSignatures({})
      setEnableUpdater(false)
      message.success(
        `v${data.release.version} 已发布，下载页和客户端版本信息已更新`,
      )
      await reload()
    } catch (err) {
      message.error(alertContext(err))
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

    try {
      await deleteRelease(release.id)
      message.success(`v${release.version} 已删除`)
      await reload()
    } catch (err) {
      message.error(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  const removeSelectedHistory = async () => {
    if (busy || !selectedHistoricalReleases.length) return
    const versions = selectedHistoricalReleases
      .map((release) => `v${release.version}`)
      .join('、')
    if (
      !window.confirm(
        `删除选中的 ${selectedHistoricalReleases.length} 个历史版本（${versions}）？这些版本将从下载页移除，安装包文件仍然保留。`,
      )
    )
      return
    setBusy('delete-history')

    try {
      const { deleted, failed } = await deleteHistoricalReleases(
        releases,
        selectedHistory,
        deleteRelease,
      )
      setSelectedHistory(failed.map((release) => release.id))
      if (failed.length)
        message.error(
          `已删除 ${deleted.length} 个历史版本。以下版本删除失败，可重试：${failed.map((release) => `v${release.version}（${alertContext(release.error)}）`).join('、')}`,
        )
      else message.success(`已删除 ${deleted.length} 个历史版本`)
      await reload()
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
      message.success(`${item.name} 已删除`)
    } catch (err) {
      message.error(alertContext(err))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="release-page stack">
      <div className="release-heading">
        <div>
          <h1>发布客户端版本</h1>
        </div>
        <a href="/download" target="_blank" rel="noreferrer">
          查看下载页 ↗
        </a>
      </div>
      <Paper
        variant="outlined"
        component="form"
        className="panel release-form stack"
        onSubmit={save}
      >
        <fieldset disabled={!!busy || loading} className="release-step">
          <legend>
            <span className="step-number">1</span> 版本信息
            <MessageHelp label="版本号说明">
              默认按已发布最高版本加 0.0.1，满 10 进位（如 0.1.9 →
              0.2.0）。可手动修改，需与安装包版本一致。
            </MessageHelp>
          </legend>
          <div className="release-version-fields">
            <label>
              版本号
              <OutlinedInput
                placeholder="例如 0.1.1"
                value={version}
                onChange={(e) => {
                  const next = e.target.value
                  if (
                    normalizeReleaseVersion(next) !==
                    normalizeReleaseVersion(version)
                  ) {
                    setSelected({})
                    setUpdates({})
                    setSignatures({})
                  }
                  setVersion(next)
                }}
                required
              />
            </label>
            <label>
              更新说明
              <OutlinedInput
                multiline
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
            <MessageHelp label="安装包上传说明">
              先填写版本号，再从 GitHub
              草稿下载并上传对应文件。这里只显示当前版本的文件，单个文件最多 512
              MiB。旧版本文件在下方文件库中查看，已被引用的文件须先删除对应版本才能清理。
            </MessageHelp>
          </legend>
          <div className="release-package-grid">
            {INSTALLER_PLATFORMS.map((platform) => (
              <Paper
                variant="outlined"
                className={`release-package-card${selected[platform.key] ? ' selected' : ''}`}
                key={platform.key}
              >
                <div className="release-card-heading">
                  <strong>
                    {PLATFORM_LABELS[platform.key]} · {platform.architecture}
                  </strong>
                  <span className="muted">
                    {selected[platform.key] ? '已选择' : '未选择'}
                  </span>
                </div>
                <div className="ops-select-field">
                  <span>安装包</span>
                  <Select
                    label={`${PLATFORM_LABELS[platform.key]} 安装包`}
                    value={selected[platform.key] ?? ''}
                    disabled={!!busy || loading || !version.trim()}
                    onChange={(name) => selectInstaller(platform.key, name)}
                    options={[
                      { value: '', label: '暂不发布此平台' },
                      ...currentPackages
                        .filter(
                          (item) =>
                            item.platform === platform.key &&
                            item.kind !== 'updater' &&
                            acceptsPackage(item.name, platform.accept),
                        )
                        .map((item) => ({
                          value: item.name,
                          label: `${item.name} · ${item.size}`,
                        })),
                    ]}
                  />
                </div>
                <div className="release-card-footer">
                  <MessageHelp
                    label={`${PLATFORM_LABELS[platform.key]} 安装包格式`}
                  >
                    {platform.hint}
                  </MessageHelp>
                  <PackageUpload
                    label="上传安装包"
                    platform={PLATFORM_LABELS[platform.key]}
                    accept={platform.accept}
                    disabled={!!busy || loading || !version.trim()}
                    onFile={(file) => void upload(file, platform.key)}
                  />
                </div>
              </Paper>
            ))}
          </div>
          {busy === 'upload' && (
            <div className="package-progress" role="status">
              <span>{progress.name}</span>
              <LinearProgress
                variant="determinate"
                value={Math.min(
                  100,
                  (100 * progress.loaded) / (progress.total || 1),
                )}
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
            <MessageHelp label="在线更新说明">
              默认由员工下载新版后安装。启用桌面在线更新时，在 GitHub 的 Client
              packages 工作流勾选 signed_updates，上传更新文件和同名 .sig
              签名。Android 使用 APK 更新，需沿用原签名并提高 versionCode。
            </MessageHelp>
          </legend>
          <label className="check">
            <Checkbox
              checked={enableUpdater}
              onChange={(event) => {
                setEnableUpdater(event.target.checked)
                if (event.target.checked && availableTargets.length === 0) {
                  message.info('请先在第 2 步选择需要在线更新的桌面安装包。')
                }
              }}
            />
            同时启用桌面客户端在线更新
          </label>
          {enableUpdater && (
            <div className="stack">
              {availableTargets.map((target) => (
                <div className="release-updater-row" key={target.key}>
                  <div>
                    <strong>{target.label}</strong>
                    <MessageHelp label={`${target.label} 更新文件格式`}>
                      {target.hint}
                    </MessageHelp>
                  </div>
                  <div className="stack">
                    <div className="ops-select-field">
                      <span>更新文件</span>
                      <Select
                        label={`${target.label} 更新文件`}
                        value={updates[target.key] ?? ''}
                        disabled={!!busy || loading}
                        onChange={(name) => {
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
                        options={[
                          { value: '', label: '此平台不启用在线更新' },
                          ...currentPackages
                            .filter(
                              (item) =>
                                item.platform === target.platform &&
                                acceptsPackage(item.name, target.accept),
                            )
                            .map((item) => ({
                              value: item.name,
                              label: item.name,
                            })),
                        ]}
                      />
                    </div>
                    <PackageUpload
                      label="上传更新文件"
                      platform={target.label}
                      accept={target.accept}
                      disabled={!!busy || loading}
                      onFile={(file) =>
                        void upload(file, target.platform, target.key)
                      }
                    />
                  </div>
                  <div className="release-signature">
                    <PackageUpload
                      label="选择签名"
                      platform={target.label}
                      accept=".sig"
                      disabled={!!busy || !updates[target.key]}
                      onFile={(file) => void readSignature(file, target.key)}
                    />
                    <span
                      className={
                        signatures[target.key] ? 'release-ready' : 'muted'
                      }
                    >
                      {busy === `verify-${target.key}`
                        ? '正在校验签名与更新文件…'
                        : signatures[target.key]
                          ? `${signatures[target.key].name} · 校验通过`
                          : updates[target.key]
                            ? '待选择签名'
                            : '未启用'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                : '尚未选择安装包'}
              {enableUpdater &&
                ` · ${updaterTargets.filter(({ key }) => signatures[key]?.text).length} 项在线更新已就绪`}
            </p>
          </div>
          <Button type="submit" disabled={!canPublish}>
            {busy === 'publish' ? '正在发布…' : '发布版本'}
          </Button>
        </div>
      </Paper>
      <Paper
        variant="outlined"
        component="section"
        className="panel release-history"
      >
        <div className="release-section-heading">
          <h2>已发布版本</h2>
          <span className="muted">{releases.length} 个版本</span>
        </div>
        {historicalReleases.length > 0 && (
          <div className="row-form release-history-actions">
            <label className="check">
              <Checkbox
                checked={
                  selectedHistoricalReleases.length ===
                  historicalReleases.length
                }
                disabled={!!busy || loading}
                onChange={(event) =>
                  setSelectedHistory(
                    event.target.checked
                      ? historicalReleases.map((release) => release.id)
                      : [],
                  )
                }
              />
              全选历史版本
            </label>
            <span className="muted">
              已选择 {selectedHistoricalReleases.length} 个
            </span>
            <Button
              variant="outlined"
              type="button"
              disabled={
                !!busy || loading || selectedHistoricalReleases.length === 0
              }
              onClick={() => void removeSelectedHistory()}
            >
              {busy === 'delete-history' ? '正在删除…' : '删除所选版本'}
            </Button>
          </div>
        )}
        {loading && <p className="muted">加载中…</p>}
        {!loading && releases.length === 0 && (
          <p className="muted">暂无已发布版本。</p>
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
                  {index > 0 ? (
                    <label className="check">
                      <Checkbox
                        checked={selectedHistory.includes(release.id)}
                        disabled={!!busy || loading}
                        onChange={(event) =>
                          setSelectedHistory((value) =>
                            event.target.checked
                              ? [...value, release.id]
                              : value.filter((id) => id !== release.id),
                          )
                        }
                      />
                      <strong>v{release.version}</strong>
                    </label>
                  ) : (
                    <strong>v{release.version}</strong>
                  )}
                  {index === 0 && (
                    <Chip label="当前版本" color="primary" variant="outlined" />
                  )}
                  <span className="muted">
                    {new Date(release.pub_date * 1000).toLocaleString('zh-CN')}
                  </span>
                </div>
                <Button
                  variant="outlined"
                  color="error"
                  type="button"
                  disabled={!!busy}
                  onClick={() => void removeRelease(release)}
                >
                  删除版本
                </Button>
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
      </Paper>
      <Accordion className="panel release-library" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          文件库 <span className="muted">{packages.length} 个文件</span>
        </AccordionSummary>
        <AccordionDetails>
          <div className="package-table">
            <Table className="mobile-cards">
              <TableHead>
                <TableRow>
                  <TableCell>文件名</TableCell>
                  <TableCell>平台 / 用途</TableCell>
                  <TableCell>大小</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {packages.map((item) => (
                  <TableRow key={item.name}>
                    <TableCell data-label="文件名">
                      <Button
                        variant="outlined"
                        type="button"
                        onClick={() =>
                          void downloadAdminPackage(item.name).catch((err) =>
                            message.error(alertContext(err)),
                          )
                        }
                      >
                        {item.name}
                      </Button>
                    </TableCell>
                    <TableCell data-label="平台 / 用途">
                      {PLATFORM_LABELS[item.platform]} ·{' '}
                      {item.kind === 'updater' ? '更新包' : '安装包'}
                    </TableCell>
                    <TableCell data-label="大小">{item.size}</TableCell>
                    <TableCell data-label="操作" className="actions">
                      <div className="action-buttons">
                        <Button
                          variant="outlined"
                          color="error"
                          type="button"
                          disabled={!!busy}
                          onClick={() => void removePackage(item)}
                        >
                          删除文件
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!packages.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="muted">
                      暂无文件。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </AccordionDetails>
      </Accordion>
    </section>
  )
}

function DingtalkPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [agentId, setAgentId] = useState('')
  const [corpId, setCorpId] = useState('')
  const message = useMessage()
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
      message.success('钉钉设置已保存')
    } catch (err) {
      message.error(alertContext(err))
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
    <Paper component="section" variant="outlined" className="panel narrow">
      <form onSubmit={submit} className="stack">
        <fieldset>
          <legend>
            钉钉登录{' '}
            <MessageHelp label="钉钉接入说明">
              在钉钉管理后台「企业信息」查找
              CorpId，将回调地址填入开放平台「登录与分享」的 Redirect
              URI。员工下载需要本公司成员授权。首次登录自动创建员工账号，已绑定的员工继续使用原账号。
            </MessageHelp>
          </legend>
          <label>
            AppKey（Client ID）
            <OutlinedInput
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
            />
          </label>
          <label>
            AppSecret
            <OutlinedInput
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
            AgentId（可选）
            <OutlinedInput
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            />
          </label>
          <label>
            企业 CorpId（员工下载必填）
            <OutlinedInput
              placeholder="填写公司 CorpId 以启用员工下载"
              value={corpId}
              onChange={(e) => setCorpId(e.target.value)}
            />
          </label>
          <label>
            登录回调地址
            <OutlinedInput
              readOnly
              value={`${location.origin}/api/v1/auth/dingtalk/callback`}
              onFocus={(event) => event.target.select()}
            />
          </label>
        </fieldset>
        <div className="row-form">
          <Button type="submit">保存</Button>
        </div>
      </form>
    </Paper>
  )
}

function GatewayHeroMedia() {
  const compact = useMediaQuery('(max-width: 650px)')
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [failedVideo, setFailedVideo] = useState('')
  const media = compact
    ? {
        light: mobileHeroVideo,
        dark: mobileHeroDarkVideo,
        gif: mobileHeroAnimation,
        still: mobileHeroStill,
      }
    : {
        light: heroVideo,
        dark: heroDarkVideo,
        gif: heroAnimation,
        still: heroStill,
      }
  const video = dark ? media.dark : media.light

  if (reduceMotion || failedVideo === video) {
    return (
      <img
        src={reduceMotion ? media.still : media.gif}
        alt=""
        fetchPriority="high"
      />
    )
  }

  return (
    <video
      key={video}
      src={video}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      onError={() => setFailedVideo(video)}
    />
  )
}

function GatewayPage() {
  return (
    <main className="gateway-page">
      <header className="gateway-masthead">
        <div className="entry-brand">
          <img src={mark} alt="" />
          VergeN
        </div>
        <Button
          variant="outlined"
          href="/login"
          startIcon={<AdminPanelSettingsOutlined />}
        >
          管理员登录
        </Button>
      </header>
      <Paper
        component="section"
        className="gateway-hero"
        aria-labelledby="gateway-title"
      >
        <GatewayHeroMedia />
        <div className="gateway-intro">
          <h1 id="gateway-title">
            公司 <span>VPN</span>
          </h1>
          <p>用公司钉钉登录，下载客户端或领取 iOS 订阅。</p>
          <Button href="/download" endIcon={<ArrowForwardRounded />}>
            下载客户端
          </Button>
        </div>
      </Paper>
      <section className="gateway-systems" aria-labelledby="systems-title">
        <h2 id="systems-title">支持平台</h2>
        <List disablePadding aria-labelledby="systems-title">
          {INSTALLER_PLATFORMS.map(({ key, architecture }) => {
            const glyph = PLATFORM_GLYPHS[key]
            return (
              <li key={key}>
                <SvgIcon viewBox={glyph.viewbox} aria-hidden="true">
                  {glyph.paths.map((path) => (
                    <path key={path} d={path} />
                  ))}
                </SvgIcon>
                <ListItemText
                  primary={PLATFORM_LABELS[key]}
                  secondary={architecture}
                />
              </li>
            )
          })}
          <li>
            <PhoneIphoneRounded />
            <ListItemText primary="iOS" secondary="Clash Mi" />
          </li>
        </List>
      </section>
    </main>
  )
}

function DownloadPage({ onBack }: { onBack: () => void }) {
  const [downloads, setDownloads] = useState<EmployeeDownloads | null>(null)
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
      setDownloads(await fetchDownloadReleases())
    } catch (err) {
      setError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="download-wrap">
      <div className="download-hero">
        <div className="entry-brand">
          <img src={mark} alt="" /> VergeN
        </div>
        <h1>客户端下载</h1>
      </div>

      {error ? (
        <LoadError error={error} onRetry={() => void load()} />
      ) : releases === null ? (
        <div className="muted" style={{ textAlign: 'center', padding: 32 }}>
          加载中…
        </div>
      ) : releases.length === 0 ? (
        <Paper variant="outlined" className="download-version">
          <div className="download-grid">
            <IOSDownloadCard />
          </div>
        </Paper>
      ) : (
        releases.map((release, index) => (
          <Paper
            component="section"
            variant="outlined"
            className="download-version"
            key={release.id}
          >
            <div className="download-version-head">
              <div className="download-version-title">
                <Chip
                  label={index === 0 ? '最新版本' : '历史版本'}
                  color={index === 0 ? 'primary' : 'default'}
                  variant="outlined"
                />
                <strong>v{release.version}</strong>
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
              <div className="muted download-notes">{release.notes}</div>
            )}
            <div
              className={
                index === 0
                  ? 'download-grid download-current-grid'
                  : 'download-grid'
              }
            >
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
              {index === 0 && <IOSDownloadCard />}
            </div>
          </Paper>
        ))
      )}
      {packages.length > 0 && (
        <Accordion className="download-version download-legacy" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreRounded />}>
            其他安装包 <span className="muted">尚未归入版本的文件</span>
          </AccordionSummary>
          <AccordionDetails>
            <div className="download-grid download-legacy-grid">
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
          </AccordionDetails>
        </Accordion>
      )}
      <Button variant="text" startIcon={<ArrowBackRounded />} onClick={onBack}>
        返回
      </Button>
    </main>
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
    <CardActionArea
      component="a"
      disabled={disabled}
      className={`platform-card${disabled ? ' platform-card-disabled' : ''}`}
      href={disabled ? undefined : url}
      target="_blank"
      rel="noreferrer"
      aria-disabled={disabled}
    >
      <svg viewBox={glyph.viewbox} width="34" height="34" aria-hidden>
        {glyph.paths.map((path) => (
          <path
            key={path.slice(0, 14)}
            d={path}
            fill={kind === 'macos' ? 'currentColor' : glyph.color}
          />
        ))}
      </svg>
      <span>{label}</span>
      {fileName && <span className="download-file-name">{fileName}</span>}
      <span className="muted" style={{ fontSize: 12 }}>
        {disabled ? '暂无安装包' : size ? `下载 · ${size}` : '下载'}
      </span>
    </CardActionArea>
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
  const message = useMessage()
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)

    try {
      const user = await apiLogin(username, password)
      onLogin(user.username)
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-wrap">
      <Paper
        component="form"
        variant="outlined"
        className="login-card"
        onSubmit={submit}
      >
        <div className="entry-brand">
          <img src={mark} alt="" /> VergeN
        </div>
        <h1>管理员登录</h1>
        <label>
          账号
          <OutlinedInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <OutlinedInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </Button>
        {onBack && (
          <Button variant="outlined" type="button" onClick={onBack}>
            返回
          </Button>
        )}
      </Paper>
    </main>
  )
}

const timeOf = (ts: number | null) =>
  ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '从未'

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const message = useMessage()
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [bindId, setBindId] = useState<number | null>(null)
  const [bindDingtalk, setBindDingtalk] = useState('')

  const [loadError, setLoadError] = useState('')
  const reload = useCallback(async () => {
    setLoadError('')
    try {
      const data = await listUsers()
      setUsers(data.users ?? [])
    } catch (err) {
      setLoadError(alertContext(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!newName.trim()) {
      message.error('请输入用户名')
      return
    }
    if (newPassword.length < 4) {
      message.error('密码至少 4 位')
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
      message.error(err instanceof Error ? err.message : String(err))
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
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const reset = async (id: number) => {
    if (resetPassword.length < 4) {
      message.error('密码至少 4 位')
      return
    }
    try {
      await setUserPassword(id, resetPassword)
      setResetId(null)
      setResetPassword('')
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const bind = async (id: number) => {
    try {
      await setUserDingtalk(id, bindDingtalk.trim())
      setBindId(null)
      setBindDingtalk('')

      await reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="workspace-title">
        <h1>员工账号</h1>
        {users && <Chip variant="outlined" label={`${users.length} 个账号`} />}
      </div>
      <Paper component="section" variant="outlined" className="panel">
        <form className="create-form" onSubmit={create}>
          <TextField
            label="用户名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <TextField
            label="初始密码(至少 4 位)"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Select
            label="账号角色"
            value={newRole}
            onChange={(value) => setNewRole(value as 'user' | 'admin')}
            disabled={busy}
            options={[
              { value: 'user', label: '员工' },
              { value: 'admin', label: '管理员' },
            ]}
          />
          <Button type="submit" disabled={busy}>
            创建账号
          </Button>
        </form>
        {loadError && (
          <LoadError error={loadError} onRetry={() => void reload()} />
        )}
        <div className="table-scroll">
          <Table className="mobile-cards">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>姓名 / 账号</TableCell>
                <TableCell>钉钉</TableCell>
                <TableCell>角色</TableCell>
                <TableCell>最近在线</TableCell>
                <TableCell>客户端</TableCell>
                <TableCell>操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell data-label="ID">{user.id}</TableCell>
                  <TableCell data-label="姓名 / 账号" title={user.username}>
                    {user.display_name || user.username}
                  </TableCell>
                  <TableCell data-label="钉钉">
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
                  </TableCell>
                  <TableCell data-label="角色">
                    {user.role === 'admin' ? '管理员' : '员工'}
                  </TableCell>
                  <TableCell data-label="最近在线" title={user.last_os || ''}>
                    {timeOf(user.last_seen_at)}
                    {user.last_version ? ` · v${user.last_version}` : ''}
                  </TableCell>
                  <TableCell data-label="客户端">
                    {[user.last_os, user.last_version]
                      .filter(Boolean)
                      .join(' / ') || '-'}
                  </TableCell>
                  <TableCell data-label="操作" className="actions">
                    <div className="action-buttons">
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() =>
                          void remove(
                            user.id,
                            user.display_name || user.username,
                          )
                        }
                      >
                        删除
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() =>
                          setResetId(resetId === user.id ? null : user.id)
                        }
                      >
                        重置密码
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setBindId(bindId === user.id ? null : user.id)
                          setBindDingtalk(user.dingtalk_userid)
                        }}
                      >
                        {user.dingtalk_userid ? '重新绑定' : '绑定钉钉'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!users?.length && !loadError && (
                <TableRow>
                  <TableCell colSpan={7} className="empty-cell">
                    {users ? '暂无员工账号' : '加载中…'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {resetId !== null && (
          <Dialog
            open
            fullWidth
            maxWidth="xs"
            aria-labelledby="edit-title"
            onClose={() => setResetId(null)}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void reset(resetId)
              }}
            >
              <DialogTitle id="edit-title">
                为 #{resetId} 设置新密码
              </DialogTitle>
              <DialogContent className="edit-fields">
                <TextField
                  type="password"
                  label="新密码(至少 4 位)"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </DialogContent>
              <DialogActions>
                <Button variant="outlined" onClick={() => setResetId(null)}>
                  取消
                </Button>
                <Button type="submit">确认</Button>
              </DialogActions>
            </form>
          </Dialog>
        )}
        {bindId !== null && (
          <Dialog
            open
            fullWidth
            maxWidth="xs"
            aria-labelledby="edit-title"
            onClose={() => setBindId(null)}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void bind(bindId)
              }}
            >
              <DialogTitle id="edit-title">
                为 #{bindId} 绑定钉钉 UnionID
              </DialogTitle>
              <DialogContent className="edit-fields">
                <TextField
                  label="钉钉 UnionID(留空解除绑定)"
                  value={bindDingtalk}
                  onChange={(e) => setBindDingtalk(e.target.value)}
                />
              </DialogContent>
              <DialogActions>
                <Button variant="outlined" onClick={() => setBindId(null)}>
                  取消
                </Button>
                <Button type="submit">确认</Button>
              </DialogActions>
            </form>
          </Dialog>
        )}
      </Paper>
    </>
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
      <LoadError
        error={error}
        onRetry={() => {
          setError('')
          void load()
        }}
      />
    ) : (
      <div className="muted">加载中…</div>
    )
  }

  const cards: [string, string | number][] = [
    ['总账号', stats.total_users],
    ['近 5 分钟在线', stats.online],
    ['近 24 小时活跃', stats.active_24h],
  ]

  return (
    <Paper component="section" variant="outlined" className="panel">
      {error && (
        <LoadError
          error={error}
          onRetry={() => {
            setError('')
            void load()
          }}
        />
      )}
      <div className="cards">
        {cards.map(([label, value]) => (
          <Paper variant="outlined" className="card" key={label}>
            <div className="card-label">{label}</div>
            <div className="card-value">{value}</div>
          </Paper>
        ))}
      </div>
      <div className="two-col">
        <DistTable title="版本分布" data={stats.version_distribution} />
        <DistTable title="操作系统分布" data={stats.os_distribution} />
      </div>
    </Paper>
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
        <Table>
          <TableBody>
            {rows.map(([key, count]) => (
              <TableRow key={key}>
                <TableCell>{key}</TableCell>
                <TableCell>{count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

  const compact = useMediaQuery('(max-width: 960px)')
  const [menuOpen, setMenuOpen] = useState(false)
  const title = TABS.find(([key]) => key === tab)![1]

  if (downloadMatch) {
    const error = new URLSearchParams(window.location.search).get('login_error')
    if (error !== null) {
      const messages: Record<string, string> = {
        config: '请联系管理员配置钉钉应用和企业 CorpId。',
        expired: '授权已过期，请重新登录。',
        canceled: '钉钉授权未完成。',
        corp: '请使用本公司组织的钉钉账号。',
        disabled: '该账号已停用，请联系管理员。',
        busy: '登录过于频繁，请稍后再试。',
      }
      return (
        <MessageProvider>
          <main className="login-wrap">
            <Paper className="gateway-card" variant="outlined">
              <div className="entry-brand">
                <img src={mark} alt="" /> VergeN
              </div>
              <h1>员工下载</h1>
              <MessageNotice
                kind="warning"
                text={messages[error] ?? '钉钉登录失败，请重试。'}
              />
              <Button
                onClick={() => window.location.replace('/download/login')}
              >
                重新使用钉钉登录
              </Button>
            </Paper>
          </main>
        </MessageProvider>
      )
    }
    return (
      <MessageProvider>
        <DownloadPage onBack={() => navigate('/')} />
      </MessageProvider>
    )
  }

  if (!authed) {
    return (
      <Routes>
        <Route path="/" element={<GatewayPage />} />
        <Route
          path="/login"
          element={
            <MessageProvider>
              <LoginPage
                onBack={() => navigate('/')}
                onLogin={(username) => {
                  setUser(username)
                  setAuthed(true)
                  navigate('/', { replace: true })
                }}
              />
            </MessageProvider>
          }
        />
        <Route path="*" element={<GatewayPage />} />
      </Routes>
    )
  }

  return (
    <div className="shell">
      <Drawer
        variant={compact ? 'temporary' : 'permanent'}
        open={!compact || menuOpen}
        onClose={() => setMenuOpen(false)}
        slotProps={{ paper: { className: 'sidebar' } }}
      >
        <div className="sidebar-brand">
          <img src={mark} alt="" /> VergeN
        </div>
        <List component="nav" aria-label="运维导航" className="sidebar-links">
          {TABS.map(([key, label]) => {
            const Icon = tabIcons[key]
            return (
              <ListItemButton
                key={key}
                selected={tab === key}
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => {
                  setTab(key)
                  setMenuOpen(false)
                  window.scrollTo(0, 0)
                }}
              >
                <ListItemIcon>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            )
          })}
        </List>
        <div className="sidebar-foot">
          <AdminPanelSettingsOutlined />
          <span>{user || '管理员'}</span>
          <IconButton
            aria-label="退出登录"
            title="退出登录"
            onClick={() => {
              clearToken()
              setUser('')
              setMenuOpen(false)
              setAuthed(false)
              navigate('/', { replace: true })
            }}
          >
            <LogoutRounded fontSize="small" />
          </IconButton>
        </div>
      </Drawer>
      <div className="workspace">
        <header className="workbar">
          {compact ? (
            <IconButton
              aria-label="打开运维导航"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <MenuRounded />
            </IconButton>
          ) : (
            <AppsRounded fontSize="small" />
          )}
          <span>VergeN 运维面板</span>
        </header>
        <main className="workspace-main">
          {tab !== 'users' && tab !== 'release' && tab !== 'ios' && (
            <h1>{title}</h1>
          )}
          <MessageProvider key={tab}>
            {tab === 'users' && <UsersPanel />}
            {tab === 'subscription' && <SubscriptionsPage />}
            {tab === 'release' && <ReleasePage />}
            {tab === 'ios' && <IOSSettingsPage />}
            {tab === 'dingtalk' && <DingtalkPage />}
            {tab === 'announcement' && <AnnouncementPage />}
            {tab === 'dashboard' && <DashboardPanel />}
          </MessageProvider>
        </main>
      </div>
    </div>
  )
}
