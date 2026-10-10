import { SyncOutlined, TokenOutlined } from '@mui/icons-material'
import {
  Box,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { enterpriseActions, useEnterpriseSession } from '@/hooks/use-enterprise'
import type { CompanySubscription } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

export const SubscriptionSourceCard = () => {
  const { t } = useTranslation()
  const session = useEnterpriseSession()
  const options = session?.subscriptions ?? []

  const switchTo = useLockFn(async (url: string) => {
    const label =
      options.find((option) => option.url === url)?.name.trim() ||
      options.find((option) => option.url === url)?.url ||
      url
    try {
      await enterpriseActions.selectSubscription(url)
      showNotice.success(
        t('home.components.subscriptionSource.feedback.switched', {
          subscription: label,
        }),
      )
    } catch {
      // mutate() already surfaced the error
    }
  })

  if (!session?.enabled || !session.authenticated || options.length < 2) {
    return null
  }

  const current = session.subscription_url ?? options[0].url
  const labelOf = (option: CompanySubscription) =>
    option.name.trim() || option.url

  return (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TokenOutlined color="primary" fontSize="small" />
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {t('home.components.subscriptionSource.title')}
        </Typography>
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <TextField
        select
        fullWidth
        size="small"
        label={t('home.components.subscriptionSource.pickerLabel')}
        value={current}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          void switchTo(event.target.value)
        }
      >
        {options.map((option) => (
          <MenuItem key={option.url} value={option.url}>
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {labelOf(option)}
            </Box>
          </MenuItem>
        ))}
      </TextField>
      <Typography
        variant="caption"
        sx={{ display: 'block', mt: 1, color: 'text.secondary' }}
      >
        <SyncOutlined sx={{ fontSize: 12, verticalAlign: 'middle', mr: 0.5 }} />
        {t('home.components.subscriptionSource.hint')}
      </Typography>
    </Box>
  )
}
