import {
  Alert,
  Box,
  Button,
  Paper,
  SvgIcon,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import VergenMark from '@/assets/image/vergen-mark.svg?react'
import { NoticeManager } from '@/components/layout/notice-manager'
import { enterpriseActions } from '@/hooks/use-enterprise'
import { useVerge } from '@/hooks/use-verge'
import { useCustomTheme } from '@/pages/_layout/hooks'
import {
  cachedDingtalkEnabled,
  checkDingtalkAvailability,
  dingtalkServer,
} from '@/services/dingtalk-availability'

const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 150
const POLL_ERROR_TOLERANCE = 3

// Baked at build time (.env / .env.production); employees never type the
// company server address.
const envServerUrl = String(
  import.meta.env.VITE_ENTERPRISE_SERVER_URL ?? '',
).trim()

const qrErrorMessages = {
  fail: 'login.dingtalk.failed',
  expired: 'login.dingtalk.expired',
  network: 'login.capabilities.failed',
  disabled: 'login.capabilities.disabled',
} as const

type QrPhase = 'starting' | 'scanning' | 'ok' | keyof typeof qrErrorMessages

function qrErrorPhase(error: unknown): keyof typeof qrErrorMessages {
  const code =
    error && typeof error === 'object' && 'code' in error && error.code
  if (code === 'ENTERPRISE_QR_NETWORK') return 'network'
  if (code === 'ENTERPRISE_QR_DISABLED') return 'disabled'
  return 'fail'
}

const DingtalkQrPanel = ({ serverUrl }: { serverUrl: string }) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<QrPhase>('starting')
  const [detail, setDetail] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let session = ''
    let timer = 0
    let attempts = 0
    let errors = 0
    const cancelSession = () => {
      if (session) {
        void enterpriseActions.cancelQr(serverUrl, session)
        session = ''
      }
    }

    const fail = (error: unknown) => {
      if (!active) return
      cancelSession()
      setPhase(qrErrorPhase(error))
    }

    const tick = async () => {
      try {
        const result = await enterpriseActions.dingtalkQrPoll(
          serverUrl,
          session,
        )
        if (!active) return
        if (!result.ok) {
          if (++errors >= POLL_ERROR_TOLERANCE) return fail(undefined)
          timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          return
        }
        errors = 0
        const { status, message } = result.value
        if (status === 'pending') {
          if (++attempts >= POLL_MAX_ATTEMPTS) {
            cancelSession()
            setPhase('expired')
          } else {
            timer = window.setTimeout(tick, POLL_INTERVAL_MS)
          }
          return
        }
        session = ''
        if (status === 'ok') {
          await enterpriseActions.completeQrLogin(() => active)
          if (active) setPhase('ok')
        } else if (status === 'expired') {
          setPhase('expired')
        } else {
          setDetail(message)
          setPhase('fail')
        }
      } catch (error) {
        if (
          active &&
          session &&
          qrErrorPhase(error) === 'network' &&
          ++errors < POLL_ERROR_TOLERANCE
        ) {
          timer = window.setTimeout(tick, POLL_INTERVAL_MS)
        } else {
          fail(error)
        }
      }
    }

    const start = async () => {
      try {
        const result = await enterpriseActions.dingtalkQrStart(serverUrl)
        if (!result.ok) return fail(undefined)
        session = result.value.session_id
        if (!active) return cancelSession()
        setPhase('scanning')
        timer = window.setTimeout(tick, POLL_INTERVAL_MS)
      } catch (error) {
        fail(error)
      }
    }

    timer = window.setTimeout(start, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
      cancelSession()
    }
  }, [attempt, serverUrl])

  const retry = () => {
    setPhase('starting')
    setDetail('')
    setAttempt((n) => n + 1)
  }

  const errorMessage =
    phase === 'starting' || phase === 'scanning' || phase === 'ok'
      ? undefined
      : qrErrorMessages[phase]

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
        {phase === 'scanning' && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {t('login.dingtalk.hint')}
            </Typography>
            <Button size="small" variant="outlined" onClick={retry}>
              {t('login.dingtalk.retry')}
            </Button>
          </Box>
        )}
        {phase === 'ok' && (
          <Typography variant="h5" sx={{ color: 'success.main' }}>
            ✓
          </Typography>
        )}
        {errorMessage && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography
              role="status"
              variant="body2"
              sx={{ color: 'text.secondary', mb: 2 }}
            >
              {t(errorMessage)}
              {detail && (
                <>
                  <br />
                  {detail}
                </>
              )}
            </Typography>
            <Button size="small" variant="outlined" onClick={retry}>
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
          {t('login.dingtalk.waiting')}
        </Typography>
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

export const EnterpriseLogin = () => {
  useCustomTheme()
  const { verge } = useVerge()
  // A previously provisioned device keeps its stored address; everyone else
  // uses the address baked into the build. Any stored value without an
  // http(s) scheme is ignored so the backend reports the env address.
  const storedServerUrl = verge?.enterprise_server_url?.trim() ?? ''
  const serverUrl = /^https?:\/\//.test(storedServerUrl)
    ? storedServerUrl
    : envServerUrl || storedServerUrl
  const qrServer = dingtalkServer(serverUrl)
  return (
    <LoginMethods
      key={qrServer ?? ''}
      serverUrl={serverUrl}
      qrServer={qrServer}
      noticePosition={verge?.notice_position}
    />
  )
}

const LoginMethods = ({
  serverUrl,
  qrServer,
  noticePosition,
}: {
  serverUrl: string
  qrServer?: string
  noticePosition?: IVergeConfig['notice_position']
}) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState(0)
  const [available, setAvailable] = useState(() =>
    cachedDingtalkEnabled(qrServer),
  )
  const [checking, setChecking] = useState(Boolean(qrServer))
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!qrServer) return
    return checkDingtalkAvailability(qrServer, (enabled) => {
      if (enabled !== undefined) setAvailable(enabled)
      if (enabled === false) setTab(0)
      setChecking(false)
    })
  }, [qrServer, round])

  const recheck = () => {
    if (checking || !qrServer) return
    setChecking(true)
    setRound((n) => n + 1)
  }
  const dingtalkAvailable = Boolean(qrServer) && available !== false
  const tabs = [
    { key: 'password', label: t('login.tabs.password') },
    { key: 'dingtalk', label: t('login.tabs.dingtalk') },
  ]

  return (
    <Box
      sx={[
        ({ palette: { mode } }) => ({
          bgcolor: mode === 'light' ? '#ECECEC' : '#2E303D',
        }),
      ]}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <NoticeManager position={noticePosition} />
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
          square
          elevation={0}
          sx={[
            ({ palette: { mode } }) => ({
              width: 380,
              maxWidth: '90vw',
              p: 4,
              borderRadius: '8px',
              bgcolor: mode === 'light' ? '#ffffff' : '#1e1f27',
              border: '1px solid',
              borderColor: 'var(--divider-color, rgba(0, 0, 0, 0.06))',
              overflow: 'auto',
            }),
          ]}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '7px',
              mb: 3,
              mt: 1,
            }}
          >
            <SvgIcon
              component={VergenMark}
              inheritViewBox
              style={{
                height: '28px',
                width: '28px',
                marginLeft: '-3px',
                color: 'text.primary',
              }}
            />
            <Typography
              component="span"
              sx={{
                fontWeight: 700,
                fontSize: '19px',
                lineHeight: 1,
                letterSpacing: 0.2,
                color: 'text.primary',
              }}
            >
              VergeN
            </Typography>
          </Box>
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', textAlign: 'center', mb: 3 }}
          >
            {t('login.page.subtitle')}
          </Typography>

          <Tabs
            value={tab}
            onChange={(_, next: number) => setTab(next)}
            variant="fullWidth"
            sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}
          >
            {tabs.map((entry) => (
              <Tab
                key={entry.key}
                label={entry.label}
                disabled={entry.key === 'dingtalk' && !dingtalkAvailable}
              />
            ))}
          </Tabs>

          {!dingtalkAvailable && (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={
                qrServer && (
                  <Button
                    color="inherit"
                    size="small"
                    disabled={checking}
                    onClick={recheck}
                  >
                    {t('login.capabilities.retry')}
                  </Button>
                )
              }
            >
              {t(
                qrServer
                  ? 'login.capabilities.disabled'
                  : 'login.capabilities.unconfigured',
              )}
            </Alert>
          )}

          {tab === 0 ? (
            <PasswordForm serverUrl={serverUrl} />
          ) : dingtalkAvailable && qrServer ? (
            <DingtalkQrPanel serverUrl={qrServer} />
          ) : null}
          {dingtalkAvailable && tab === 1 && (
            <Button
              size="small"
              disabled={checking}
              onClick={recheck}
              sx={{ mt: 1 }}
            >
              {t('login.capabilities.retry')}
            </Button>
          )}
        </Paper>
      </Box>
    </Box>
  )
}
