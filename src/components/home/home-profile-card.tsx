import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  LaunchOutlined,
  UpdateOutlined,
} from '@mui/icons-material'
import {
  Box,
  LinearProgress,
  Link,
  Stack,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import i18next from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useEnterpriseSession } from '@/hooks/use-enterprise'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import { updateProfile } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import type { TranslationKey } from '@/types/generated/i18n-keys'
import { openExternalUrl } from '@/utils/open-external-url'

import { EnhancedCard } from './enhanced-card'
import { ShieldMascot } from './shield-mascot'
import type { MascotMood } from './shield-mascot'

// 定义旋转动画
const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

const openProfileHome = (url: string) => {
  void openExternalUrl(url).catch(showNotice.error)
}

// 使用类型定义，而不是导入
interface ProfileExtra {
  upload: number
  download: number
  total: number
  expire: number
}

interface ProfileItem {
  uid: string
  type?: 'local' | 'remote' | 'merge' | 'script'
  name?: string
  desc?: string
  file?: string
  url?: string
  updated?: number
  extra?: ProfileExtra
  home?: string
  option?: any
}

interface HomeProfileCardProps {
  current: ProfileItem | null | undefined
  onProfileUpdated?: () => void
}

// 提取独立组件减少主组件复杂度
const ProfileDetails = ({
  current,
  onUpdateProfile,
  updating,
}: {
  current: ProfileItem
  onUpdateProfile: () => void
  updating: boolean
}) => {
  const session = useEnterpriseSession()

  const { t } = useTranslation()
  const theme = useTheme()

  const usedTraffic = useMemo(() => {
    if (!current.extra) return 0
    return current.extra.upload + current.extra.download
  }, [current.extra])

  const trafficPercentage = useMemo(() => {
    if (!current.extra || !current.extra.total || current.extra.total <= 0)
      return 0
    return Math.min(Math.round((usedTraffic / current.extra.total) * 100), 100)
  }, [current.extra, usedTraffic])

  const { proxyView, isProxyViewError } = useProxiesData()
  const mascotMood: MascotMood = isProxyViewError
    ? 'sad'
    : proxyView
      ? 'happy'
      : 'idle'

  const welcome = useMemo(() => {
    const hour = new Date().getHours()
    const slot = (():
      | 'midnight'
      | 'morning'
      | 'noon'
      | 'afternoon'
      | 'evening' => {
      if (hour < 5) return 'midnight'
      if (hour < 11) return 'morning'
      if (hour < 14) return 'noon'
      if (hour < 18) return 'afternoon'
      return 'evening'
    })()
    const key = `shared.labels.welcome.${slot}` as TranslationKey
    // 登录态下 username 必有;降级串不再走 i18n(键并入运行时回退)
    const name = session?.username ?? current.name ?? 'VergeN'
    // 欢迎语的插值绕开 i18next 的严格键类型(仅此一处使用局部签名)
    const untypedT = i18next.t as unknown as (
      k: string,
      o?: Record<string, unknown>,
    ) => string
    return untypedT(key, { name })
  }, [session?.username, current.name])

  return (
    <Box>
      <Stack spacing={2}>
        {current.updated && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <UpdateOutlined
              fontSize="small"
              color="action"
              sx={{
                cursor: 'pointer',
                animation: updating ? `${round} 1.5s linear infinite` : 'none',
              }}
              onClick={onUpdateProfile}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ cursor: 'pointer' }}
              onClick={onUpdateProfile}
            >
              {t('shared.labels.updateTime')}:{' '}
              <Box component="span" sx={{ fontWeight: 'medium' }}>
                {dayjs(current.updated * 1000).format('YYYY-MM-DD HH:mm')}
              </Box>
            </Typography>
          </Stack>
        )}

        {current.extra && (
          <>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <ShieldMascot mood={mascotMood} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={[
                    ({ palette: { mode } }) => {
                      // 实色等效 8% 主色叠加,避免尾巴与气泡半透明叠层出菱形缝
                      const bg = mode === 'dark' ? '#2b2d39' : '#ebf4ff'
                      return {
                        position: 'relative',
                        display: 'inline-block',
                        bgcolor: bg,
                        borderRadius: 2,
                        px: 1.25,
                        py: 0.75,
                        ml: 1,
                        '&::after': {
                          content: '""',
                          position: 'absolute',
                          left: -4,
                          bottom: 12,
                          width: 9,
                          height: 9,
                          bgcolor: bg,
                          transform: 'rotate(45deg)',
                          borderRadius: 0.5,
                        },
                      }
                    },
                  ]}
                >
                  {welcome}
                </Typography>
              </Box>
            </Stack>

            <Box sx={{ mt: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.5, display: 'block' }}
              >
                {trafficPercentage}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={trafficPercentage}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: alpha(theme.palette.primary.main, 0.12),
                }}
              />
            </Box>
          </>
        )}
      </Stack>
    </Box>
  )
}

// 提取空配置组件
const EmptyProfile = () => {
  const { t } = useTranslation()

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 2.4,
        borderRadius: 2,
      }}
    >
      <CloudDownloadOutlined
        sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }}
      />
      <Typography variant="h6" gutterBottom>
        {t('profiles.components.card.labels.waitingForManagedTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('profiles.components.card.labels.waitingForManagedHint')}
      </Typography>
    </Box>
  )
}

export const HomeProfileCard = ({
  current,
  onProfileUpdated,
}: HomeProfileCardProps) => {
  const { t } = useTranslation()
  const { refreshAll } = useAppRefreshers()

  // 更新当前订阅
  const [updating, setUpdating] = useState(false)

  const onUpdateProfile = useLockFn(async () => {
    if (!current?.uid) return

    setUpdating(true)
    try {
      await mutate(() => updateProfile(current.uid, current.option), {
        id: `update-profile:${current.uid}`,
        errorNotice: false,
      })
      onProfileUpdated?.()

      // 刷新首页数据
      refreshAll()
    } catch (err) {
      showNotice.error(err, 3000)
    } finally {
      setUpdating(false)
    }
  })

  // 卡片操作:配置由公司统一下发,不再跳转订阅管理页

  // 卡片标题
  const cardTitle = useMemo(() => {
    if (!current) return t('profiles.page.title')

    if (!current.home) return current.name

    return (
      <Link
        component="button"
        variant="h6"
        onClick={() => current.home && openProfileHome(current.home)}
        sx={{
          color: 'inherit',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          maxWidth: '100%',
          fontWeight: 'medium',
          fontSize: 18,
          '& > span': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          },
        }}
        title={current.name}
      >
        <span>{current.name}</span>
        <LaunchOutlined
          fontSize="inherit"
          sx={{
            ml: 0.5,
            fontSize: '0.8rem',
            opacity: 0.7,
            flexShrink: 0,
          }}
        />
      </Link>
    )
  }, [current, t])

  return (
    <EnhancedCard
      title={cardTitle}
      icon={<CloudUploadOutlined />}
      iconColor="info"
    >
      {current ? (
        <ProfileDetails
          current={current}
          onUpdateProfile={onUpdateProfile}
          updating={updating}
        />
      ) : (
        <EmptyProfile />
      )}
    </EnhancedCard>
  )
}
