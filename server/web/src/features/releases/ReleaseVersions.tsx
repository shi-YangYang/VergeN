import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import { type Dispatch, type SetStateAction } from 'react'

import { type AdminRelease } from '../../api'

import {
  INSTALLER_PLATFORMS,
  PLATFORM_LABELS,
  UPDATER_TARGETS,
} from './platforms'

export function ReleaseVersions({
  releases,
  selectedHistory,
  setSelectedHistory,
  loading,
  busy,
  removeRelease,
  removeSelectedHistory,
}: {
  releases: AdminRelease[]
  selectedHistory: number[]
  setSelectedHistory: Dispatch<SetStateAction<number[]>>
  loading: boolean
  busy: string
  removeRelease: (release: AdminRelease) => Promise<void>
  removeSelectedHistory: () => Promise<void>
}) {
  const historicalReleases = releases.slice(1)
  const selectedHistoryCount = historicalReleases.filter((release) =>
    selectedHistory.includes(release.id),
  ).length
  return (
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
              checked={selectedHistoryCount === historicalReleases.length}
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
          <span className="muted">已选择 {selectedHistoryCount} 个</span>
          <Button
            variant="outlined"
            type="button"
            disabled={!!busy || loading || selectedHistoryCount === 0}
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
  )
}
