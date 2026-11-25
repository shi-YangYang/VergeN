import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useCallback, useEffect, useState } from 'react'

import mark from '../../../../src/assets/image/vergen-mark.svg'
import { fetchDownloadReleases, type EmployeeDownloads } from '../api'
import { PLATFORM_GLYPHS, type PlatformKey } from '../assets/platform-glyphs'
import { alertContext } from '../components/message-context'
import { LoadError } from '../components/Messages'
import { PHONE_LAYOUT_QUERY } from '../components/PhoneLayout'
import { IOSDownloadCard, IOSLoginPrompt } from '../features/ios/IOSAccess'
import { PLATFORM_LABELS } from '../features/releases/platforms'

export function DownloadPage({ onBack }: { onBack: () => void }) {
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  const [downloads, setDownloads] = useState<EmployeeDownloads | null>(null)
  const [error, setError] = useState('')
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(
    null,
  )
  const releases = downloads?.releases ?? null
  const latest = releases?.[0]
  const release =
    releases?.find((item) => item.id === selectedReleaseId) ?? latest
  const isLatest = release === latest
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

  const desktopInstallers = release && (
    <>
      <PlatformCard kind="windows" label="Windows" url={release.win_url} />
      <PlatformCard kind="macos" label="macOS" url={release.mac_url} />
      <PlatformCard kind="linux" label="Linux" url={release.linux_url} />
    </>
  )

  return (
    <main className="download-wrap">
      <IOSLoginPrompt />
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
      ) : !release ? (
        <Paper variant="outlined" className="download-version">
          <div className="download-grid">
            <IOSDownloadCard />
          </div>
        </Paper>
      ) : (
        <Paper
          component="section"
          variant="outlined"
          className="download-version"
        >
          <div className="download-version-head">
            {releases.length > 1 ? (
              <Autocomplete
                className="download-version-picker"
                size="small"
                disableClearable
                openOnFocus
                options={releases}
                value={release}
                getOptionKey={(item) => item.id}
                getOptionLabel={(item) => `v${item.version}`}
                onChange={(_, item) => setSelectedReleaseId(item.id)}
                noOptionsText="没有匹配的版本"
                openText="展开版本列表"
                closeText="收起版本列表"
                renderInput={(params) => (
                  <TextField {...params} label="选择版本" />
                )}
              />
            ) : (
              <strong>v{release.version}</strong>
            )}
            <div className="download-version-title">
              <Chip
                label={isLatest ? '最新版本' : '历史版本'}
                color={isLatest ? 'primary' : 'default'}
                variant="outlined"
              />
              {release.pub_date > 0 && (
                <span className="muted">
                  {new Date(release.pub_date * 1000).toLocaleDateString(
                    'zh-CN',
                  )}
                </span>
              )}
            </div>
          </div>
          {phone ? (
            <>
              <div className="download-phone-apps">
                <PlatformCard
                  kind="android"
                  label="Android"
                  url={release.android_url}
                />
                {isLatest && <IOSDownloadCard />}
              </div>
              <Accordion className="download-phone-details" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                  电脑客户端
                </AccordionSummary>
                <AccordionDetails className="desktop-installers">
                  {desktopInstallers}
                </AccordionDetails>
              </Accordion>
              {release.notes && (
                <Accordion className="download-phone-details" disableGutters>
                  <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                    更新说明
                  </AccordionSummary>
                  <AccordionDetails className="muted download-notes">
                    {release.notes}
                  </AccordionDetails>
                </Accordion>
              )}
            </>
          ) : (
            <>
              {release.notes && (
                <div className="muted download-notes">{release.notes}</div>
              )}
              <div
                className={
                  isLatest
                    ? 'download-grid download-current-grid'
                    : 'download-grid'
                }
              >
                {desktopInstallers}
                <PlatformCard
                  kind="android"
                  label="Android"
                  url={release.android_url}
                />
                {isLatest && <IOSDownloadCard />}
              </div>
            </>
          )}
        </Paper>
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
