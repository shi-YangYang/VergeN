import { Box, LinearProgress, Typography } from '@mui/material'
import type { Ref } from 'react'
import { lazy, Suspense, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { isCompanyUpdate, useUpdate } from '@/hooks/use-update'
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

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const release = isCompanyUpdate(updateInfo) ? updateInfo : null

  const openUrlWithNotice = (url: string) => {
    if (!url) return
    void openExternalUrl(url).catch(showNotice.error)
  }

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
      disableOk={!release?.url}
      okBtn={release?.url ? t('settings.modals.companyUpdate.download') : ''}
      onOk={() => {
        if (release?.url) openUrlWithNotice(release.url)
      }}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
    >
      {release?.notes?.trim() ? (
        <Suspense fallback={<LinearProgress />}>
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
            <LazyReactMarkdown>{release.notes}</LazyReactMarkdown>
          </Box>
        </Suspense>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {release
            ? t('settings.modals.update.messages.available')
            : t('shared.statuses.loading')}
        </Typography>
      )}
    </BaseDialog>
  )
}
