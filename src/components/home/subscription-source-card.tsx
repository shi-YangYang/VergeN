import { SyncOutlined, TokenOutlined } from '@mui/icons-material'
import {
  Box,
  Grid,
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

import { EnhancedCard } from './enhanced-card'

/** Home tile letting employees switch among enabled company subscriptions;
 *  hidden outside managed devices, when fewer than two picks exist, or
 *  when the current pick is not in the enabled set. */
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

  if (
    !session?.enabled ||
    !session.authenticated ||
    options.length < 2 ||
    !options.some((option) => option.url === session.subscription_url)
  ) {
    return null
  }

  const current = session.subscription_url ?? options[0].url
  const labelOf = (option: CompanySubscription) =>
    option.name.trim() || option.url

  return (
    <Grid size={6}>
      <EnhancedCard
        title={t('home.components.subscriptionSource.title')}
        icon={<TokenOutlined />}
        iconColor="primary"
      >
        <Stack spacing={1} sx={{ width: '100%' }}>
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
            sx={{ display: 'block', color: 'text.secondary' }}
          >
            <SyncOutlined
              sx={{ fontSize: 12, verticalAlign: 'middle', mr: 0.5 }}
            />
            {t('home.components.subscriptionSource.hint')}
          </Typography>
        </Stack>
      </EnhancedCard>
    </Grid>
  )
}
