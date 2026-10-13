import { Box, LinearProgress, Typography } from '@mui/material'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import type { Ref } from 'react'
import { lazy, Suspense, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { isCompanyUpdate, useUpdate } from '@/hooks/use-update'
import { enterpriseUpdaterInstall } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { openExternalUrl } from '@/utils/open-external-url'

// Release notes are authored by ops in markdown, so they share the update
// viewer's renderer without its GitHub-flavor extras.
const LazyReactMarkdown = lazy(async () => {
  const { default: ReactMarkdown } = await import('react-markdown')
  const { default: remarkGfm } = await import('remark-gfm')
  return {
    default: (props: { children?: string }) => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} {...props} />
    ),
  }
})

interface Props {
  ref?: Ref<DialogRef>
}

export const CompanyUpdateViewer = ({ ref }: Props) => {
  const { t } = useTranslation()
  const { updateInfo } = useUpdate()
  const [open, setOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal] = useState(0)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const release = isCompanyUpdate(updateInfo) ? updateInfo : null

  const openUrlWithNotice = (url: string) => {
    if (!url) return
    void openExternalUrl(url).catch(showNotice.error)
  }

  const onInstall = async () => {
    if (!release?.updater_available || installing) return
    setInstalling(true)
    setDownloaded(0)
    setTotal(0)
    const onDownloadEvent = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        setTotal(event.data.contentLength ?? 0)
        setDownloaded(0)
        return
      }
      if (event.event === 'Progress') {
        setDownloaded((prev) => prev + event.data.chunkLength)
        return
      }
      if (event.event === 'Finished') {
        setDownloaded((prev) => prev)
      }
    }
    await mutate(() => enterpriseUpdaterInstall(onDownloadEvent), {
      id: 'enterprise-updater-install',
      onFulfilled: (installed) => {
        if (!installed) {
          setOpen(false)
          showNotice.success(
            'settings.components.verge.advanced.notifications.latestVersion',
          )
        }
      },
    })
      .catch(() => {})
      .finally(() => setInstalling(false))
  }

  const progress = total <= 0 ? 0 : Math.min((downloaded / total) * 100, 100)

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            minWidth: 0,
          }}
        >
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {release
              ? t('settings.modals.update.title', { version: release.version })
              : t('shared.statuses.loading')}
          </Box>
          {release?.url && (
            <Typography
              component="a"
              href="#"
              onClick={(event) => {
                event.preventDefault()
                openUrlWithNotice(release.url)
              }}
              sx={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {t('settings.modals.companyUpdate.download')}
            </Typography>
          )}
        </Box>
      }
      contentSx={{
        width: { xs: 'calc(100vw - 56px)', sm: 560 },
        maxWidth: 'calc(100vw - 56px)',
        height: 'min(64vh, 680px)',
        display: 'flex',
        flexDirection: 'column',
        pb: 1,
      }}
      loading={installing}
      disableOk={
        !release || installing || (!release.updater_available && !release.url)
      }
      okBtn={
        release?.updater_available
          ? t('settings.modals.companyUpdate.installNow')
          : t('settings.modals.companyUpdate.download')
      }
      onOk={() => {
        if (release?.updater_available) void onInstall()
        else if (release?.url) openUrlWithNotice(release.url)
      }}
      cancelBtn={
        installing
          ? t('settings.modals.companyUpdate.updating')
          : t('shared.actions.cancel')
      }
      disableCancel={installing}
      onCancel={() => setOpen(false)}
      onClose={() => {
        if (!installing) setOpen(false)
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          pr: 1.5,
          mr: -1,
          fontSize: 14,
          lineHeight: 1.65,
          color: 'text.primary',
          overflowWrap: 'break-word',
          '& a': {
            color: 'primary.main',
            overflowWrap: 'anywhere',
          },
          '& p': {
            my: 1,
          },
          '& ul, & ol': {
            my: 1,
            pl: 2.75,
          },
          '& code': {
            px: 0.5,
            py: 0.125,
            borderRadius: 0.5,
            bgcolor: 'action.hover',
            fontSize: '0.92em',
          },
          '& pre': {
            my: 1.5,
            p: 1.5,
            overflow: 'auto',
            borderRadius: 1,
            bgcolor: 'action.hover',
          },
        }}
      >
        {release && !release.updater_available && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('settings.modals.companyUpdate.manualInstall')}
          </Typography>
        )}
        {release?.notes?.trim() ? (
          <Suspense fallback={<LinearProgress />}>
            <LazyReactMarkdown>{release.notes}</LazyReactMarkdown>
          </Suspense>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {release
              ? t('settings.modals.update.messages.available')
              : t('shared.statuses.loading')}
          </Typography>
        )}
      </Box>
      {installing && total > 0 && (
        <LinearProgress variant="determinate" value={progress} sx={{ mt: 1 }} />
      )}
      {installing && total === 0 && <LinearProgress sx={{ mt: 1 }} />}
    </BaseDialog>
  )
}
