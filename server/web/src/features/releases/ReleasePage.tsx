import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import LinearProgress from '@mui/material/LinearProgress'
import OutlinedInput from '@mui/material/OutlinedInput'
import Paper from '@mui/material/Paper'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  createRelease,
  deleteRelease,
  listReleases,
  listPackages,
  uploadPackage,
  verifyPackageSignature,
  deletePackage,
  type AdminRelease,
  type PackageFile,
} from '../../api'
import { useMessage, alertContext } from '../../components/message-context'
import { MessageHelp } from '../../components/Messages'
import { Select } from '../../components/Select'

import { PackageUpload } from './PackageUpload'
import {
  INSTALLER_PLATFORMS,
  PLATFORM_LABELS,
  UPDATER_TARGETS,
  type ReleasePlatform,
} from './platforms'
import {
  acceptsPackage,
  normalizeReleaseVersion,
  packageMatchesVersion,
} from './release-files'
import { deleteHistoricalReleases, nextReleaseVersion } from './release-history'
import { RELEASE_SECTIONS, type ReleaseSection } from './release-sections'
import { ReleaseFileLibrary } from './ReleaseFileLibrary'
import { ReleaseVersions } from './ReleaseVersions'

export function ReleasePage({ section }: { section: ReleaseSection }) {
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
          <h1>{RELEASE_SECTIONS[section]}</h1>
        </div>
        <a href="/download" target="_blank" rel="noreferrer">
          查看下载页 ↗
        </a>
      </div>
      {section === 'publish' && (
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
                草稿下载并上传对应文件。这里只显示当前版本的文件，单个文件最多
                512
                MiB。旧版本文件在「文件库」中查看，已被引用的文件须先删除对应版本才能清理。
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
                      version={version}
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
                  {Math.floor((progress.loaded / (progress.total || 1)) * 100)}%
                  · {(progress.loaded / 1024 / 1024).toFixed(1)} /{' '}
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
                默认由员工下载新版后安装。启用桌面在线更新时，在 GitHub 的
                Client packages 工作流勾选 signed_updates，上传更新文件和同名
                .sig 签名。Android 使用 APK 更新，需沿用原签名并提高
                versionCode。
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
                    <div className="updater-platform">
                      <strong>{target.label}</strong>
                      <MessageHelp label={`${target.label} 更新文件格式`}>
                        {target.hint}
                      </MessageHelp>
                    </div>
                    <span className="updater-label">更新文件</span>
                    <div className="updater-select">
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
                    <div className="updater-upload">
                      <PackageUpload
                        label="上传更新文件"
                        platform={target.label}
                        version={version}
                        accept={target.accept}
                        disabled={!!busy || loading}
                        onFile={(file) =>
                          void upload(file, target.platform, target.key)
                        }
                      />
                    </div>
                    <div className="updater-signature">
                      <PackageUpload
                        label="选择签名"
                        platform={target.label}
                        version={version}
                        expectedName={
                          updates[target.key]
                            ? updates[target.key] + '.sig'
                            : undefined
                        }
                        accept={target.accept
                          .split(',')
                          .map((ext) => ext + '.sig')
                          .join(',')}
                        disabled={!!busy || !updates[target.key]}
                        onFile={(file) => void readSignature(file, target.key)}
                      />
                    </div>
                    <span
                      className={
                        'updater-status ' +
                        (signatures[target.key] ? 'release-ready' : 'muted')
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
      )}
      {section === 'versions' && (
        <ReleaseVersions
          releases={releases}
          selectedHistory={selectedHistory}
          setSelectedHistory={setSelectedHistory}
          loading={loading}
          busy={busy}
          removeRelease={removeRelease}
          removeSelectedHistory={removeSelectedHistory}
        />
      )}
      {section === 'files' && (
        <ReleaseFileLibrary
          packages={packages}
          busy={!!busy}
          loading={loading}
          removePackage={removePackage}
        />
      )}
    </section>
  )
}
