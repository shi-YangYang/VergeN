import { useEffect, useRef, useState } from 'react'

import {
  claimIOSSubscription,
  listIOSSubscriptions,
  getIOSSubscriptionAddress,
  importIOSSubscriptions,
  revokeIOSSubscription,
  type IOSSubscription,
} from '../api'
import { PLATFORM_GLYPHS } from '../assets/platform-glyphs'

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
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    dialogRef.current?.showModal()
    let active = true
    getIOSSubscriptionAddress(row.id)
      .then((result) => {
        if (active) setUrl(result.url)
      })
      .catch((err) => {
        if (active) setFeedback(err.message)
      })
    return () => {
      active = false
    }
  }, [row.id])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setFeedback('已复制订阅地址')
    } catch {
      fieldRef.current?.focus()
      fieldRef.current?.select()
      setFeedback('已选中地址，可手动复制')
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="ios-dialog ios-address-dialog"
      onClose={onClose}
      aria-labelledby="ios-address-title"
    >
      <div className="release-section-heading">
        <h2 id="ios-address-title">订阅地址 #{row.id}</h2>
        <button className="ghost" onClick={() => dialogRef.current?.close()}>
          关闭
        </button>
      </div>
      <p>
        {row.status === 'available'
          ? '员工领取后，此地址生效。'
          : row.status === 'revoked'
            ? '此地址已撤销。'
            : `领取人 · ${row.employee}`}
      </p>
      <input
        ref={fieldRef}
        aria-label="完整订阅地址"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        placeholder={feedback ? undefined : '读取中…'}
      />
      <div className="row-form">
        <button
          disabled={!url || row.status === 'revoked'}
          onClick={() => void copy()}
        >
          复制地址
        </button>
        <span className="muted" role="status">
          {feedback}
        </span>
      </div>
    </dialog>
  )
}

function IOSImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (added: number, skipped: number) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const readFile = async (file: File) => {
    setError('')
    if (file.size > 256 * 1024 || !file.name.toLowerCase().endsWith('.txt')) {
      setError('请选择 256 KiB 以内的 UTF-8 文本文件（.txt）')
      return
    }
    setBusy(true)
    try {
      setText(await file.text())
    } catch {
      setError('文件读取失败，请重新选择')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const { added, skipped } = await importIOSSubscriptions(text)
      onImported(added, skipped)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请重试')
      setBusy(false)
    }
  }

  return (
    <dialog
      className="ios-dialog ios-import-dialog"
      ref={dialogRef}
      aria-labelledby="ios-import-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault()
      }}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id="ios-import-title">导入订阅地址</h2>
        <label>
          订阅地址
          <textarea
            autoFocus
            rows={6}
            spellCheck={false}
            autoComplete="off"
            value={text}
            disabled={busy}
            placeholder="粘贴家宽订阅地址，每行一条"
            onChange={(e) => {
              setText(e.target.value)
              setError('')
            }}
          />
        </label>
        <label>
          从 .txt 文件读取
          <input
            type="file"
            accept=".txt,text/plain"
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (file) void readFile(file)
            }}
          />
        </label>
        <span className="muted">
          每次最多 1000 条。新地址进入「待领取」，重复地址会跳过。
        </span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
        <div className="ios-import-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => dialogRef.current?.close()}
          >
            取消
          </button>
          <button type="submit" disabled={busy || !text.trim()}>
            {busy ? '处理中…' : '确认导入'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function IOSSettingsPage() {
  const [items, setItems] = useState<IOSSubscription[]>([])
  const [filter, setFilter] = useState<(typeof filters)[number]>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<IOSSubscription | null>(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const run = async (action?: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (action) setMessage(await action())
      const response = await listIOSSubscriptions()
      setItems(response.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void run()
  }, [])
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
        `撤销订阅 #${row.id}${row.employee ? '（' + row.employee + '）' : ''}？链接将失效，已领取的员工无法再次领取。手机已缓存的节点仍可使用。`,
      )
    )
      return
    void run(async () => {
      await revokeIOSSubscription(row.id)
      return `已撤销订阅 #${row.id}`
    })
  }

  return (
    <section className="panel ios-pool" aria-label="iOS 订阅地址管理">
      <div className="ios-pool-heading">
        <h2>iOS 订阅地址管理</h2>
        <div className="row-form">
          <button className="ghost" disabled={busy} onClick={() => void run()}>
            刷新
          </button>
          <button disabled={busy} onClick={() => setImporting(true)}>
            导入订阅地址
          </button>
        </div>
      </div>
      <div className="ios-pool-toolbar">
        <div
          className="ios-pool-filters"
          role="group"
          aria-label="按订阅状态筛选"
        >
          {filters.map((status) => {
            const count =
              status === 'all'
                ? items.length
                : items.filter((item) => item.status === status).length
            return (
              <button
                key={status}
                aria-pressed={filter === status}
                onClick={() => {
                  setFilter(status)
                  setPage(1)
                }}
              >
                {status === 'all' ? '全部' : statusLabels[status]}{' '}
                <span>{count}</span>
              </button>
            )
          })}
        </div>
        <input
          type="search"
          aria-label="搜索订阅"
          placeholder="搜索员工、编号或地址尾号"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
        />
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div
        className="table-scroll ios-pool-scroll"
        role="region"
        aria-label="订阅地址表"
        tabIndex={0}
      >
        <table aria-label="iOS 订阅地址" aria-busy={busy}>
          <thead>
            <tr>
              {['编号', '订阅地址', '状态', '领取员工', '领取时间', '操作'].map(
                (title) => (
                  <th scope="col" key={title}>
                    {title}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>#{row.id}</td>
                <td className="ios-address-preview">{row.address_preview}</td>
                <td>
                  <span className={'ios-state ' + row.status}>
                    {statusLabels[row.status]}
                  </span>
                </td>
                <td>{row.employee || '—'}</td>
                <td>
                  {row.assigned_at
                    ? new Date(row.assigned_at * 1000).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td>
                  <div className="action-buttons">
                    <button className="ghost" onClick={() => setSelected(row)}>
                      查看地址
                    </button>
                    {row.status !== 'revoked' && (
                      <button
                        className="ghost ios-revoke"
                        disabled={busy}
                        onClick={() => revoke(row)}
                      >
                        撤销
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="ios-pool-empty">
                  {busy
                    ? '正在读取订阅地址…'
                    : error
                      ? '订阅地址读取失败'
                      : items.length === 0
                        ? '暂无订阅地址，可在上方导入。'
                        : '没有匹配的订阅地址'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {matches.length > 0 && (
        <footer className="ios-pool-pager">
          <span>
            第 {start + 1}–{start + visible.length} 条，共 {matches.length} 条
          </span>
          <div className="action-buttons">
            <button
              className="ghost"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </button>
            <span>
              {current} / {pages}
            </span>
            <button
              className="ghost"
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </button>
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
    </section>
  )
}

export function IOSDownloadCard() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const manualCopyRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const apple = PLATFORM_GLYPHS.macos

  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = async () => {
    setBusy(true)
    setStatus('idle')
    setError('')
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
      )
        setStatus('copied')
      else setStatus('manual')
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (status === 'manual') {
      manualCopyRef.current?.focus()
      manualCopyRef.current?.select()
    }
  }, [status])

  return (
    <>
      <button
        type="button"
        className="platform-card ios-card"
        aria-haspopup="dialog"
        onClick={() => {
          setError('')
          setStatus('idle')
          dialogRef.current?.showModal()
        }}
      >
        <svg viewBox={apple.viewbox} width="34" height="34" aria-hidden="true">
          <path d={apple.paths[0]} fill="currentColor" />
        </svg>
        <span>iOS</span>
        <small className="muted">使用 Clash Mi</small>
      </button>
      <dialog
        ref={dialogRef}
        className="ios-dialog"
        aria-labelledby="ios-dialog-title"
      >
        <div className="release-section-heading">
          <h2 id="ios-dialog-title">在 iOS 上使用 Clash Mi</h2>
          <button
            type="button"
            className="ghost"
            aria-label="关闭弹窗"
            onClick={() => dialogRef.current?.close()}
          >
            关闭
          </button>
        </div>
        <p>安装 Clash Mi 后，复制你的专属订阅地址并在应用中导入。</p>
        <div className="ios-dialog-actions">
          <a href={clashMiStoreURL} target="_blank" rel="noreferrer">
            下载 Clash Mi
          </a>
          <button type="button" disabled={busy} onClick={() => void copy()}>
            {busy ? '领取中…' : '复制订阅地址'}
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div role="status">
          {status === 'copied' && <p>订阅地址已复制</p>}
          {status === 'manual' && (
            <label className="ios-manual-copy">
              请长按地址，选择「复制」
              <input
                ref={manualCopyRef}
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          )}
        </div>
      </dialog>
    </>
  )
}
