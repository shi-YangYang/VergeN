import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'
import Portal from '@mui/material/Portal'
import Snackbar from '@mui/material/Snackbar'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { MessageContext, type MessageKind, useMessage } from './message-context'

type Notice = { id: number; kind: MessageKind; text: string }

export function MessageProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const nextIdRef = useRef(0)
  const message = useMemo(() => {
    const show = (kind: MessageKind) => (text: string) => {
      const next = { id: ++nextIdRef.current, kind, text }
      setNotice(next)
      return () => setNotice((current) => (current === next ? null : current))
    }
    return {
      success: show('success'),
      error: show('error'),
      info: show('info'),
      warning: show('warning'),
    }
  }, [])
  const close = () =>
    setNotice((current) => (current === notice ? null : current))

  return (
    <MessageContext value={message}>
      {children}
      {notice && (
        <Portal
          key={notice.id}
          container={() =>
            document.querySelector<HTMLElement>(
              '[role="dialog"][aria-modal="true"]',
            ) ?? document.body
          }
        >
          <Snackbar
            open
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            autoHideDuration={Math.min(
              18000,
              Math.max(4000, notice.text.length * 180),
            )}
            onClose={(_, reason) => {
              if (reason !== 'clickaway') close()
            }}
          >
            <Alert
              severity={notice.kind}
              variant="filled"
              role={
                notice.kind === 'error' || notice.kind === 'warning'
                  ? 'alert'
                  : 'status'
              }
              closeText="关闭提示"
              onClose={close}
              sx={{
                maxWidth: 'min(560px, calc(100vw - 24px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-line',
                boxShadow: 3,
              }}
            >
              {notice.text}
            </Alert>
          </Snackbar>
        </Portal>
      )}
    </MessageContext>
  )
}

export function MessageNotice({
  kind,
  text,
}: {
  kind: MessageKind
  text: string
}) {
  const message = useMessage()
  useEffect(() => message[kind](text), [message, kind, text])
  return null
}

export function MessageHelp({
  label,
  children,
}: {
  label: string
  children: string
}) {
  const message = useMessage()
  return (
    <IconButton
      size="small"
      type="button"
      aria-label={label}
      onClick={() => message.info(children)}
    >
      <HelpOutlineRounded fontSize="small" />
    </IconButton>
  )
}
