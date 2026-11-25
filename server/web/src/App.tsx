import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined'
import AppsRounded from '@mui/icons-material/AppsRounded'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import InsertChartOutlined from '@mui/icons-material/InsertChartOutlined'
import LinkRounded from '@mui/icons-material/LinkRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import MenuRounded from '@mui/icons-material/MenuRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded'
import BottomNavigation from '@mui/material/BottomNavigation'
import BottomNavigationAction from '@mui/material/BottomNavigationAction'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Drawer from '@mui/material/Drawer'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
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
  hasToken,
  login as apiLogin,
  logout,
  mayRestoreDevice,
  refreshAdminAccess,
  watchDeviceChanges,
} from './admin-session'
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  setAnnouncementEnabled,
  setSubscriptionEnabled,
  createSubscription,
  createUser,
  deleteSubscription,
  getDashboard,
  getSettings,
  listSubscriptions,
  listUsers,
  patchSettings,
  setUserDingtalk,
  setUserPassword,
  deleteUser,
  updateAnnouncement,
  updateSubscription,
  type AdminAnnouncement,
  type AdminSettings,
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
import { PLATFORM_GLYPHS } from './assets/platform-glyphs'
import { useMessage, alertContext } from './components/message-context'
import {
  MessageHelp,
  MessageNotice,
  MessageProvider,
  LoadError,
} from './components/Messages'
import { CreateFormSection, PHONE_LAYOUT_QUERY } from './components/PhoneLayout'
import { Select } from './components/Select'
import { IOSSettingsPage } from './features/ios/IOSAccess'
import {
  INSTALLER_PLATFORMS,
  PLATFORM_LABELS,
} from './features/releases/platforms'
import { ReleasePage } from './features/releases/ReleasePage'
import { DownloadPage } from './pages/DownloadPage'

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
      <CreateFormSection label="添加订阅">
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
      </CreateFormSection>
      {loadError && (
        <LoadError error={loadError} onRetry={() => void reload()} />
      )}
      <div className="table-scroll">
        <Table className="mobile-cards records-table">
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
                <TableCell className="record-id" data-label="ID">
                  {sub.id}
                </TableCell>
                <TableCell className="record-name" data-label="名称">
                  {sub.name || '-'}
                </TableCell>
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
      <CreateFormSection label="添加公告">
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
      </CreateFormSection>
      {loadError && (
        <LoadError error={loadError} onRetry={() => void reload()} />
      )}
      <div className="table-scroll">
        <Table className="mobile-cards records-table">
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
                <TableCell className="record-id" data-label="ID">
                  {item.id}
                </TableCell>
                <TableCell className="record-name" data-label="标题">
                  {item.title}
                </TableCell>
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
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  const renderPlatform = ({
    key,
    architecture,
  }: (typeof INSTALLER_PLATFORMS)[number]) => {
    const glyph = PLATFORM_GLYPHS[key]
    return (
      <li key={key}>
        <SvgIcon viewBox={glyph.viewbox} aria-hidden="true">
          {glyph.paths.map((path) => (
            <path key={path} d={path} />
          ))}
        </SvgIcon>
        <ListItemText primary={PLATFORM_LABELS[key]} secondary={architecture} />
      </li>
    )
  }
  const ios = (
    <li key="ios">
      <PhoneIphoneRounded />
      <ListItemText primary="iOS" secondary="Clash Mi" />
    </li>
  )
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
            企业 <span>VPN</span>
          </h1>
          <p>先选择客户端，下载安装包或领取 iOS 订阅时再用公司钉钉登录。</p>
          <Button href="/download" endIcon={<ArrowForwardRounded />}>
            下载客户端
          </Button>
        </div>
      </Paper>
      <section className="gateway-systems" aria-labelledby="systems-title">
        <h2 id="systems-title">支持平台</h2>
        {phone ? (
          <>
            <List
              disablePadding
              aria-label="手机平台"
              className="gateway-phone-platforms"
            >
              {INSTALLER_PLATFORMS.filter(({ key }) => key === 'android').map(
                renderPlatform,
              )}
              {ios}
            </List>
            <List
              disablePadding
              aria-label="电脑平台"
              className="gateway-desktop-platforms"
            >
              {INSTALLER_PLATFORMS.filter(({ key }) => key !== 'android').map(
                renderPlatform,
              )}
            </List>
          </>
        ) : (
          <List disablePadding aria-labelledby="systems-title">
            {INSTALLER_PLATFORMS.map(renderPlatform)}
            {ios}
          </List>
        )}
      </section>
    </main>
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
  const [remember, setRemember] = useState(false)
  const message = useMessage()
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)

    try {
      const user = await apiLogin(username, password, remember)
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
        <FormControlLabel
          className="check"
          control={
            <Checkbox
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
          }
          label="在此设备保持登录 7 天"
        />
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
        <CreateFormSection label="创建账号">
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
        </CreateFormSection>
        {loadError && (
          <LoadError error={loadError} onRetry={() => void reload()} />
        )}
        <div className="table-scroll">
          <Table className="mobile-cards records-table">
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
                  <TableCell className="record-id" data-label="ID">
                    {user.id}
                  </TableCell>
                  <TableCell
                    className="record-name"
                    data-label="姓名 / 账号"
                    title={user.username}
                  >
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
      <MessageProvider>
        <RouterShell />
      </MessageProvider>
    </BrowserRouter>
  )
}

function RouterShell() {
  const navigate = useNavigate()
  const downloadMatch = useMatch('/download')
  const iosDownloadMatch = useMatch('/download/ios')
  const [authed, setAuthed] = useState(hasToken)
  const isDownload = Boolean(downloadMatch || iosDownloadMatch)
  const [restoring, setRestoring] = useState(
    () => !isDownload && !hasToken() && mayRestoreDevice(),
  )
  const message = useMessage()
  useEffect(() => {
    if (isDownload) return
    const stop = watchDeviceChanges()
    let active = true
    if (!hasToken() && mayRestoreDevice()) {
      void refreshAdminAccess()
        .then((ok) => {
          if (active && ok) setAuthed(true)
        })
        .catch(() => {
          if (active) message.error('暂时未能恢复登录，可刷新重试')
        })
        .finally(() => {
          if (active) setRestoring(false)
        })
    }
    return () => {
      active = false
      stop()
    }
  }, [isDownload, message])
  const [user, setUser] = useState<string>('')
  const [tab, setTab] = useState<Tab>('users')

  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  const compact = useMediaQuery('(max-width: 960px)')
  const [menuOpen, setMenuOpen] = useState(false)
  const primaryTabs = ['users', 'subscription', 'release'] as const
  const selectTab = (value: Tab) => {
    setTab(value)
    setMenuOpen(false)
    window.scrollTo(0, 0)
  }
  const title = TABS.find(([key]) => key === tab)![1]

  if (downloadMatch || iosDownloadMatch) {
    const query = new URLSearchParams(window.location.search)
    const error = query.get('login_error')
    if (error !== null) {
      const retryQuery = new URLSearchParams()
      for (const key of ['file', 'target']) {
        const value = query.get(key)
        if (value) retryQuery.set(key, value)
      }
      const search = retryQuery.toString()
      const retry = search ? `/download/login?${search}` : '/download/login'
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
              <Button href={retry}>重新使用钉钉登录</Button>
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

  if (restoring && !hasToken() && mayRestoreDevice())
    return (
      <main className="login-wrap" role="status">
        正在恢复登录…
      </main>
    )

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
        anchor={phone ? 'bottom' : 'left'}
        variant={compact ? 'temporary' : 'permanent'}
        open={!compact || menuOpen}
        onClose={() => setMenuOpen(false)}
        slotProps={{
          paper: { className: phone ? 'sidebar phone-menu' : 'sidebar' },
        }}
      >
        <div className="sidebar-brand">
          {phone ? (
            <>
              <span>更多管理</span>
              <IconButton
                aria-label="关闭导航"
                onClick={() => setMenuOpen(false)}
              >
                <CloseRounded />
              </IconButton>
            </>
          ) : (
            <>
              <img src={mark} alt="" /> VergeN
            </>
          )}
        </div>
        <List component="nav" aria-label="运维导航" className="sidebar-links">
          {TABS.filter(
            ([key]) => !phone || !primaryTabs.some((item) => item === key),
          ).map(([key, label]) => {
            const Icon = tabIcons[key]
            return (
              <ListItemButton
                key={key}
                selected={tab === key}
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => selectTab(key)}
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
            onClick={async () => {
              try {
                await logout()
              } catch {
                message.error('退出登录失败，请检查网络后重试')
                return
              }
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
          {phone ? (
            <img src={mark} alt="" className="phone-workbar-mark" />
          ) : compact ? (
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
      {phone && (
        <BottomNavigation
          component="nav"
          aria-label="快捷导航"
          className="phone-navigation"
          showLabels
          value={
            primaryTabs.some((key) => key === tab) && !menuOpen ? tab : 'more'
          }
          onChange={(_, value: Tab | 'more') => {
            if (value === 'more') setMenuOpen(true)
            else selectTab(value)
          }}
        >
          {primaryTabs.map((key) => {
            const Icon = tabIcons[key]
            return (
              <BottomNavigationAction
                key={key}
                value={key}
                label={
                  { users: '员工', subscription: '订阅', release: '发布' }[key]
                }
                icon={<Icon />}
                aria-current={tab === key ? 'page' : undefined}
              />
            )
          })}
          <BottomNavigationAction
            value="more"
            label="更多"
            icon={<MoreHorizRounded />}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
          />
        </BottomNavigation>
      )}
    </div>
  )
}
