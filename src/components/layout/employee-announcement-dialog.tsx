import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { confirmAnnouncement } from '@/services/announcement-receipts'
import {
  type AnnouncementSession,
  type DeliveredAnnouncement,
  enterpriseAnnouncementAck,
  enterpriseAnnouncementCurrent,
} from '@/services/cmds'
import { watchEmployeeAnnouncement } from '@/services/employee-announcement'
import { showNotice } from '@/services/notice-service'

export function EmployeeAnnouncementDialog({
  server,
  username,
  epoch,
  account,
}: AnnouncementSession) {
  const { t } = useTranslation()
  const [notice, setNotice] = useState<DeliveredAnnouncement | null>(null)
  useEffect(() => {
    const session = { server, username, epoch, account }
    return watchEmployeeAnnouncement(
      session,
      () => enterpriseAnnouncementCurrent(session),
      (id, revision) => enterpriseAnnouncementAck(session, id, revision),
      setNotice,
    )
  }, [server, username, epoch, account])

  if (!notice) return null
  const acknowledge = () => {
    const session = { server, username, epoch, account }
    void confirmAnnouncement(
      session,
      notice,
      (id, revision) => enterpriseAnnouncementAck(session, id, revision),
      () =>
        setNotice((n) =>
          n?.id === notice.id && n.revision === notice.revision ? null : n,
        ),
    ).catch(() => showNotice.error('shared.feedback.errors.operationFailed'))
  }
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      scroll="paper"
      aria-labelledby="employee-announcement-title"
      aria-describedby={
        notice.content ? 'employee-announcement-body' : undefined
      }
    >
      <DialogTitle
        id="employee-announcement-title"
        sx={{ overflowWrap: 'anywhere' }}
      >
        {notice.title}
      </DialogTitle>
      {notice.content && (
        <DialogContent>
          <DialogContentText
            id="employee-announcement-body"
            sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {notice.content}
          </DialogContentText>
        </DialogContent>
      )}
      <DialogActions>
        <Button variant="contained" onClick={acknowledge}>
          {t('login.announcement.acknowledge')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
