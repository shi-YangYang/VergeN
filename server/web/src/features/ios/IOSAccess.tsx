import CloseRounded from '@mui/icons-material/CloseRounded'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import Button from '@mui/material/Button'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import OutlinedInput from '@mui/material/OutlinedInput'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMatch, useNavigate, useSearchParams } from 'react-router-dom'

import {
  claimIOSSubscription,
  listIOSSubscriptions,
  getIOSSubscriptionAddress,
  importIOSSubscriptions,
  revokeIOSSubscription,
  type IOSSubscription,
} from '../../api'
import { PLATFORM_GLYPHS } from '../../assets/platform-glyphs'
import { useMessage } from '../../components/message-context'
import { MessageHelp } from '../../components/Messages'
import { PHONE_LAYOUT_QUERY } from '../../components/PhoneLayout'

const clashMiStoreURL = 'https://apps.apple.com/us/app/clash-mi/id6744321968'

const statusLabels = {
  available: '待领取',
  assigned: '已领取',
  revoked: '已撤销',
}

const PAGE_SIZE = 20
const filters = ['all', 'available', 'assigned', 'revoked'] as const

function IOSAddressDialog({
  row,
  onClose,
}: {
  row: IOSSubscription
  onClose: () => void
}) {
  const fieldRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const message = useMessage()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    getIOSSubscriptionAddress(row.id)
      .then((result) => {
        if (active) {
          setUrl(result.url)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setLoading(false)
          message.error(err.message)
        }
      })
    return () => {
      active = false
    }
  }, [row.id, message])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      message.success('已复制订阅地址')
    } catch {
      fieldRef.current?.focus()
      fieldRef.current?.select()
      message.info('已选中地址，可手动复制')
    }
  }
  return (
    <Dialog
      open
      maxWidth="sm"
      fullWidth
      onClose={onClose}
      aria-labelledby="ios-address-title"
    >
      <DialogTitle id="ios-address-title">订阅地址 #{row.id}</DialogTitle>
      <DialogContent className="ios-address-dialog">
        <p>
          {row.status === 'available'
            ? '待领取'
            : row.status === 'revoked'
              ? '已撤销'
              : `领取人 · ${row.employee}`}
        </p>
        <OutlinedInput
          inputRef={fieldRef}
          slotProps={{ input: { 'aria-label': '完整订阅地址' } }}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={loading ? '读取中…' : undefined}
        />
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          关闭
        </Button>
        <Button
          disabled={!url || row.status === 'revoked'}
          onClick={() => void copy()}
        >
          复制地址
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function IOSImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (added: number, skipped: number) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const message = useMessage()

  const readFile = async (file: File) => {
    if (file.size > 256 * 1024 || !file.name.toLowerCase().endsWith('.txt')) {
      message.error('请选择 256 KiB 以内的 UTF-8 文本文件（.txt）')
      return
    }
    setBusy(true)
    try {
      setText(await file.text())
    } catch {
      message.error('文件读取失败，请重新选择')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)

    try {
      const { added, skipped } = await importIOSSubscriptions(text)
      onImported(added, skipped)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败，请重试')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="ios-import-title"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <DialogTitle id="ios-import-title">
          导入订阅地址{' '}
          <MessageHelp label="导入格式说明">
            请导入家宽机上已启用的链接，每行一条，最多 1000
            条。重复地址会跳过。支持 256 KiB 以内的 UTF-8 .txt 文件。
          </MessageHelp>
        </DialogTitle>
        <DialogContent className="ios-import-fields">
          <label>
            订阅地址
            <OutlinedInput
              multiline
              autoFocus
              rows={6}
              spellCheck={false}
              autoComplete="off"
              value={text}
              disabled={busy}
              placeholder="粘贴家宽订阅地址，每行一条"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Button
            variant="outlined"
            component="label"
            role={undefined}
            className="package-upload"
            startIcon={<CloudUploadOutlined />}
            disabled={busy}
          >
            从 .txt 文件读取
            <input
              type="file"
              tabIndex={-1}
              accept=".txt,text/plain"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (file) void readFile(file)
              }}
            />
          </Button>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="submit" disabled={busy || !text.trim()}>
            {busy ? '处理中…' : '确认导入'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export function IOSSettingsPage() {
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  const [items, setItems] = useState<IOSSubscription[]>([])
  const [filter, setFilter] = useState<(typeof filters)[number]>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<IOSSubscription | null>(null)
  const [busy, setBusy] = useState(true)
  const message = useMessage()

  const [loadFailed, setLoadFailed] = useState(false)
  const run = useCallback(
    async (action?: () => Promise<string>) => {
      setBusy(true)

      try {
        if (action) message.success(await action())
        const response = await listIOSSubscriptions()
        setItems(response.items ?? [])
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        message.error(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [message],
  )
  useEffect(() => {
    void run()
  }, [run])
  const needle = query.trim().toLowerCase()
  const matches = items.filter(
    (row) =>
      (filter === 'all' || row.status === filter) &&
      (!needle ||
        [String(row.id), '#' + row.id, row.employee, row.address_preview].some(
          (value) => value?.toLowerCase().includes(needle),
        )),
  )
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const start = (current - 1) * PAGE_SIZE
  const visible = matches.slice(start, start + PAGE_SIZE)

  const [importing, setImporting] = useState(false)
  const imported = (added: number, skipped: number) => {
    setImporting(false)
    if (added > 0) {
      setQuery('')
      setFilter('available')
      setPage(Number.MAX_SAFE_INTEGER)
    }
    void run(async () => `已新增 ${added} 条，跳过重复地址 ${skipped} 条`)
  }
  const revoke = (row: IOSSubscription) => {
    if (
      !window.confirm(
        `撤销订阅 #${row.id}${row.employee ? '（' + row.employee + '）' : ''}？面板将停止发放此地址，已领取的员工也无法再领取。要停用原链接，请在家宽机上操作。`,
      )
    )
      return
    void run(async () => {
      await revokeIOSSubscription(row.id)
      return `已撤销订阅 #${row.id}`
    })
  }

  const emptyLabel = busy
    ? '正在读取订阅地址…'
    : loadFailed
      ? '订阅地址读取失败'
      : items.length === 0
        ? '暂无订阅地址'
        : '没有匹配的订阅地址'
  const rows = visible.map((row) => {
    const status = (
      <Chip
        label={statusLabels[row.status]}
        variant="outlined"
        color={
          row.status === 'assigned'
            ? 'success'
            : row.status === 'available'
              ? 'primary'
              : 'default'
        }
      />
    )
    const assignedTime = row.assigned_at
      ? new Date(row.assigned_at * 1000).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—'
    const actions = (
      <div className="action-buttons">
        <Button variant="outlined" onClick={() => setSelected(row)}>
          查看地址
        </Button>
        {row.status !== 'revoked' && (
          <Button
            variant="outlined"
            color="error"
            disabled={busy}
            onClick={() => revoke(row)}
          >
            撤销
          </Button>
        )}
      </div>
    )
    if (phone) {
      return (
        <Paper
          component="li"
          variant="outlined"
          className="ios-address-card"
          key={row.id}
        >
          <div className="ios-card-heading">
            <strong>订阅 #{row.id}</strong>
            {status}
          </div>
          <code>{row.address_preview}</code>
          {(row.employee || row.assigned_at > 0) && (
            <div className="ios-card-owner">
              {row.employee && <span>领取员工 · {row.employee}</span>}
              {row.assigned_at > 0 && <span>领取时间 · {assignedTime}</span>}
            </div>
          )}
          {actions}
        </Paper>
      )
    }
    return (
      <TableRow key={row.id}>
        <TableCell>#{row.id}</TableCell>
        <TableCell className="ios-address-preview">
          {row.address_preview}
        </TableCell>
        <TableCell>{status}</TableCell>
        <TableCell>{row.employee || '—'}</TableCell>
        <TableCell>{assignedTime}</TableCell>
        <TableCell>{actions}</TableCell>
      </TableRow>
    )
  })

  return (
    <Paper
      variant="outlined"
      component="section"
      className="panel ios-pool"
      aria-label="iOS 订阅地址管理"
    >
      <div className="ios-pool-heading">
        <h1>iOS 订阅地址管理</h1>
        <div className="row-form">
          <Button
            startIcon={<RefreshRounded />}
            variant="outlined"
            disabled={busy}
            onClick={() => void run()}
          >
            刷新
          </Button>
          <Button
            startIcon={<CloudUploadOutlined />}
            disabled={busy}
            onClick={() => setImporting(true)}
          >
            导入订阅地址
          </Button>
        </div>
      </div>
      <div className="ios-pool-toolbar">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_, next: typeof filter | null) => {
            if (next) {
              setFilter(next)
              setPage(1)
            }
          }}
          className="ios-pool-filters"
          aria-label="按订阅状态筛选"
        >
          {filters.map((status) => {
            const count =
              status === 'all'
                ? items.length
                : items.filter((item) => item.status === status).length
            return (
              <ToggleButton key={status} value={status}>
                {status === 'all' ? '全部' : statusLabels[status]}{' '}
                <span>{count}</span>
              </ToggleButton>
            )
          })}
        </ToggleButtonGroup>
        <OutlinedInput
          startAdornment={
            <InputAdornment position="start">
              <SearchRounded fontSize="small" />
            </InputAdornment>
          }
          type="search"
          slotProps={{ input: { 'aria-label': '搜索订阅' } }}
          placeholder="搜索员工、编号或地址尾号"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
        />
      </div>
      {phone ? (
        <div aria-busy={busy}>
          {visible.length > 0 ? (
            <ul className="ios-address-list" aria-label="iOS 订阅地址">
              {rows}
            </ul>
          ) : (
            <p className="ios-pool-empty">{emptyLabel}</p>
          )}
        </div>
      ) : (
        <div
          className="table-scroll ios-pool-scroll"
          role="region"
          aria-label="订阅地址表"
          tabIndex={0}
        >
          <Table aria-label="iOS 订阅地址" aria-busy={busy}>
            <TableHead>
              <TableRow>
                {[
                  '编号',
                  '订阅地址',
                  '状态',
                  '领取员工',
                  '领取时间',
                  '操作',
                ].map((title) => (
                  <TableCell scope="col" key={title}>
                    {title}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="ios-pool-empty">
                    {emptyLabel}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {matches.length > 0 && (
        <footer className="ios-pool-pager">
          <span>
            第 {start + 1}–{start + visible.length} 条，共 {matches.length} 条
          </span>
          <div className="action-buttons">
            <Button
              variant="outlined"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </Button>
            <span>
              {current} / {pages}
            </span>
            <Button
              variant="outlined"
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </Button>
          </div>
        </footer>
      )}
      {importing && (
        <IOSImportDialog
          onClose={() => setImporting(false)}
          onImported={imported}
        />
      )}
      {selected && (
        <IOSAddressDialog row={selected} onClose={() => setSelected(null)} />
      )}
    </Paper>
  )
}

export function IOSLoginPrompt() {
  const [query] = useSearchParams()
  const navigate = useNavigate()
  const close = () => navigate('/download', { replace: true })

  return (
    <Dialog
      open={query.get('login_required') === 'ios'}
      onClose={close}
      maxWidth="xs"
      fullWidth
      aria-labelledby="ios-login-title"
      aria-describedby="ios-login-description"
    >
      <DialogTitle id="ios-login-title">需要使用公司钉钉登录</DialogTitle>
      <DialogContent id="ios-login-description">
        登录后即可打开 Clash Mi 的个人订阅。
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={close}>
          取消
        </Button>
        <Button href="/download/login?target=%2Fdownload%2Fios">
          使用钉钉登录
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function IOSDownloadCard() {
  const open = useMatch('/download/ios') !== null
  const navigate = useNavigate()
  const close = () => navigate('/download', { replace: true })
  const manualCopyRef = useRef<HTMLInputElement>(null)
  const [manualCopy, setManualCopy] = useState(false)
  const apple = PLATFORM_GLYPHS.macos

  const [url, setUrl] = useState('')
  const message = useMessage()
  const [busy, setBusy] = useState(false)
  const copy = async () => {
    setBusy(true)
    setManualCopy(false)

    const claim = claimIOSSubscription()
    try {
      let copied: Promise<boolean> | undefined
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const content = claim.then(
          (value) => new Blob([value], { type: 'text/plain' }),
        )
        // Safari requires clipboard.write during the original click.
        copied = navigator.clipboard
          .write([new ClipboardItem({ 'text/plain': content })])
          .then(
            () => true,
            () => false,
          )
        void content.catch(() => {})
      }
      const value = await claim
      setUrl(value)
      if (
        copied
          ? await copied
          : await navigator.clipboard?.writeText(value).then(
              () => true,
              () => false,
            )
      ) {
        message.success('订阅地址已复制')
      } else {
        setManualCopy(true)
        message.info('请长按已选中的地址，选择「复制」。')
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '领取失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (manualCopy) {
      manualCopyRef.current?.focus()
      manualCopyRef.current?.select()
    }
  }, [manualCopy])

  return (
    <>
      <CardActionArea
        component="a"
        href="/download/ios"
        className="platform-card ios-card"
        aria-haspopup="dialog"
      >
        <svg viewBox={apple.viewbox} width="34" height="34" aria-hidden="true">
          <path d={apple.paths[0]} fill="currentColor" />
        </svg>
        <span>iOS</span>
        <small className="muted">使用 Clash Mi</small>
      </CardActionArea>
      <Dialog
        open={open}
        onClose={close}
        maxWidth="xs"
        fullWidth
        aria-labelledby="ios-dialog-title"
      >
        <DialogTitle id="ios-dialog-title" className="dialog-heading">
          <span>
            在 iOS 上使用 Clash Mi{' '}
            <MessageHelp label="iOS 订阅使用说明">
              安装 Clash Mi 后，复制你的专属订阅地址并在应用中导入。
            </MessageHelp>
          </span>
          <IconButton aria-label="关闭弹窗" onClick={close}>
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        {manualCopy && (
          <DialogContent>
            <label className="ios-manual-copy">
              专属订阅地址
              <OutlinedInput
                inputRef={manualCopyRef}
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          </DialogContent>
        )}
        <DialogActions className="ios-dialog-actions">
          <Button
            variant="outlined"
            href={clashMiStoreURL}
            target="_blank"
            rel="noreferrer"
          >
            下载 Clash Mi
          </Button>
          <Button type="button" disabled={busy} onClick={() => void copy()}>
            {busy ? '领取中…' : '复制订阅地址'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
