import {
  Alert,
  Box,
  Button,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { NoticeManager } from '@/components/layout/notice-manager'
import { enterpriseActions } from '@/hooks/use-enterprise'
import { useVerge } from '@/hooks/use-verge'
import { useCustomTheme } from '@/pages/_layout/hooks'
import type { EnterpriseSession } from '@/services/cmds'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 150
const POLL_ERROR_TOLERANCE = 3

// Baked at build time (.env / .env.production); employees never type the
// company server address.
const envServerUrl = String(
  import.meta.env.VITE_ENTERPRISE_SERVER_URL ?? '',
).trim()

type QrPhase = 'starting' | 'scanning' | 'ok' | 'fail' | 'expired'

const DingtalkQrPanel = ({ serverUrl }: { serverUrl: string }) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<QrPhase>('starting')
  const [qrUrl, setQrUrl] = useState('')
  const [detail, setDetail] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pollRef = useRef({ session: '', timer: 0, attempts: 0, errors: 0 })

  useEffect(() => {
    let active = true
    let cancelled = false

    const stopPolling = () => {
      window.clearTimeout(pollRef.current.timer)
      pollRef.current.timer = 0
    }

    const tick = async () => {
      if (cancelled) return
      const session = pollRef.current.session
      if (!session) return
      try {
        const result = await enterpriseActions.dingtalkQrPoll(
          serverUrl,
          session,
        )
        if (!result.ok) {
          // Busy rejection: same shape as a transient error.
          pollRef.current.errors += 1
          if (pollRef.current.errors >= POLL_ERROR_TOLERANCE) {
            stopPolling()
            setPhase('fail')
            return
          }
          pollRef.current.timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          return
        }
        const { status, message } = result.value
        pollRef.current.errors = 0
        if (status === 'pending') {
          pollRef.current.attempts += 1
          if (pollRef.current.attempts >= POLL_MAX_ATTEMPTS) {
            await enterpriseActions.cancelQr(serverUrl, session)
            if (!cancelled) setPhase('expired')
            return
          }
          pollRef.current.timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          return
        }
        stopPolling()
        if (status === 'ok') {
          setPhase('ok')
          await enterpriseActions.completeQrLogin()
          return
        }
        if (status === 'fail') {
          setDetail(message)
          setPhase('fail')
        } else {
          setPhase('expired')
        }
      } catch {
        pollRef.current.errors += 1
        if (pollRef.current.errors >= POLL_ERROR_TOLERANCE) {
          stopPolling()
          setPhase('fail')
          return
        }
        pollRef.current.timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    const start = async () => {
      stopPolling()
      setPhase('starting')
      setQrUrl('')
      setDetail('')
      try {
        const result = await enterpriseActions.dingtalkQrStart(serverUrl)
        if (!result.ok) {
          if (active) setPhase('fail')
          return
        }
        const { qr_url, session_id } = result.value
        if (!active) {
          void enterpriseActions.cancelQr(serverUrl, session_id)
          return
        }
        setQrUrl(qr_url)
        pollRef.current = {
          session: session_id,
          timer: 0,
          attempts: 0,
          errors: 0,
        }
        setPhase('scanning')
        pollRef.current.timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      } catch {
        // mutate() already displayed the error notice
        if (active) setPhase('fail')
      }
    }

    start()
    return () => {
      active = false
      cancelled = true
      stopPolling()
      const { session } = pollRef.current
      if (session) {
        void enterpriseActions.cancelQr(serverUrl, session)
      }
    }
  }, [attempt, serverUrl])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box
        sx={{
          border: 1,
          borderRadius: 2,
          p: 2,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          bgcolor: 'background.paper2',
          height: 232,
        }}
      >
        {phase === 'starting' && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('login.dingtalk.starting')}
          </Typography>
        )}
        {(phase === 'scanning' || phase === 'ok') && qrUrl && (
          <Box sx={{ position: 'relative', borderRadius: 2 }}>
            <QRCodeSVG value={qrUrl} size={196} marginSize={0} level="M" />
            {phase === 'ok' && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'success.main',
                  borderRadius: 2,
                  color: '#fff',
                }}
              >
                <Typography variant="h5">✓</Typography>
              </Box>
            )}
          </Box>
        )}
        {(phase === 'fail' || phase === 'expired') && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {phase === 'fail'
                ? t('login.dingtalk.failed')
                : t('login.dingtalk.expired')}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('login.dingtalk.retry')}
            </Button>
          </Box>
        )}
      </Box>
      {phase === 'scanning' && (
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            textAlign: 'center',
            whiteSpace: 'pre-line',
          }}
        >
          {`${t('login.dingtalk.hint')}\n${t('login.dingtalk.waiting')}`}
        </Typography>
      )}
      {detail && (
        <Alert severity="error" icon={false}>
          <Typography variant="body2">{detail}</Typography>
        </Alert>
      )}
    </Box>
  )
}

const PasswordForm = ({ serverUrl }: { serverUrl: string }) => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { login } = enterpriseActions

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
    <form onSubmit={handleSubmit}>
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
  )
}

export const EnterpriseLogin = ({
  session,
}: {
  session: EnterpriseSession
}) => {
  const { t } = useTranslation()
  useCustomTheme()
  const { verge } = useVerge()
  // A previously provisioned device keeps its stored address; everyone else
  // uses the address baked into the build. Any stored value without an
  // http(s) scheme is ignored so the backend reports the env address.
  const storedServerUrl = verge?.enterprise_server_url?.trim() ?? ''
  const serverUrl = /^https?:\/\//.test(storedServerUrl)
    ? storedServerUrl
    : envServerUrl || storedServerUrl
  const [tab, setTab] = useState(0)

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
          sx={{ width: 380, maxWidth: '90vw', p: 4, borderRadius: 2 }}
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

          {serverUrl && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: 'text.disabled',
                textAlign: 'center',
                mb: 1,
                overflowWrap: 'anywhere',
              }}
            >
              {`${t('login.form.server')} · ${serverUrl}`}
            </Typography>
          )}

          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="fullWidth"
            sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}
          >
            <Tab label={t('login.tabs.password')} />
            <Tab label={t('login.tabs.dingtalk')} />
          </Tabs>

          {tab === 0 ? (
            <>
              <PasswordForm serverUrl={serverUrl} />
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
                    <Typography
                      variant="body2"
                      sx={{ color: 'text.secondary' }}
                    >
                      {session.announcement.content}
                    </Typography>
                  )}
                </Alert>
              )}
            </>
          ) : (
            <DingtalkQrPanel serverUrl={serverUrl} />
          )}
        </Paper>
      </Box>
    </Paper>
  )
}
