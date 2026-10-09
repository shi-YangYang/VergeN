import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { NoticeManager } from '@/components/layout/notice-manager'
import { enterpriseActions } from '@/hooks/use-enterprise'
import { useVerge } from '@/hooks/use-verge'
import { useCustomTheme } from '@/pages/_layout/hooks'
import type { EnterpriseSession } from '@/services/cmds'

export const EnterpriseLogin = ({
  session,
}: {
  session: EnterpriseSession
}) => {
  const { t } = useTranslation()
  useCustomTheme()
  const { verge } = useVerge()
  const { login } = enterpriseActions

  const [serverUrl, setServerUrl] = useState(verge?.enterprise_server_url ?? '')
  const [username, setUsername] = useState(verge?.enterprise_username ?? '')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      await login(serverUrl, username, password)
    } catch {
      // mutate() already displayed the error notice
    } finally {
      setLoading(false)
    }
  }

  return (
    <Paper
      square
      elevation={0}
      sx={[({ palette }) => ({ bgcolor: palette.background.paper })]}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <NoticeManager position={verge?.notice_position} />
      <div className="the_titlebar">
        <div
          className="the_titlebar-drag-region"
          data-tauri-drag-region="true"
        />
      </div>
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Paper
          elevation={4}
          sx={{ width: 360, maxWidth: '90vw', p: 4, borderRadius: 2 }}
        >
          <Typography
            variant="h5"
            sx={{ fontWeight: 700, textAlign: 'center', mb: 1 }}
          >
            {t('login.page.title')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', textAlign: 'center', mb: 3 }}
          >
            {t('login.page.subtitle')}
          </Typography>

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              size="small"
              label={t('login.form.server')}
              placeholder={String(t('login.form.serverPlaceholder'))}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              size="small"
              label={t('login.form.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              size="small"
              label={t('login.form.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              sx={{ mb: 3 }}
            />
            <Button
              fullWidth
              variant="contained"
              type="submit"
              loading={loading}
              sx={{ borderRadius: '8px', py: 1.2 }}
            >
              {t('login.form.submit')}
            </Button>
          </form>

          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              display: 'block',
              textAlign: 'center',
              mt: 2,
            }}
          >
            {t('login.banner.managed')}
          </Typography>

          {session.announcement && (
            <Alert severity="info" icon={false} sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {session.announcement.title}
              </Typography>
              {session.announcement.content && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {session.announcement.content}
                </Typography>
              )}
            </Alert>
          )}
        </Paper>
      </Box>
    </Paper>
  )
}
