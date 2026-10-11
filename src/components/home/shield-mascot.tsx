import { Box, Typography, keyframes } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const bodySpin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`
const mascotBounce = keyframes`
  0% { transform: translateY(0); }
  30% { transform: translateY(-10px) rotate(-4deg); }
  60% { transform: translateY(2px) rotate(3deg); }
  100% { transform: translateY(0); }
`
const heartFloat = keyframes`
  0% { opacity: 0; transform: translateY(4px) scale(0.6); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-26px) scale(1.15); }
`

export type MascotMood = 'happy' | 'idle' | 'sad'

const MOOD_FACE: Record<MascotMood, { eyes: string; mouth: string }> = {
  happy: { eyes: 'circle', mouth: 'smile' },
  idle: { eyes: 'circle', mouth: 'flat' },
  sad: { eyes: 'squeeze', mouth: 'frown' },
}

const HEARTS = [
  { x: 18, delay: 0 },
  { x: 34, delay: 0.12 },
  { x: 26, delay: 0.24 },
]

export const ShieldMascot = ({
  mood = 'idle',
  message,
}: {
  mood?: MascotMood
  message?: string
}) => {
  const { t } = useTranslation()
  const [bouncing, setBouncing] = useState(false)
  const [hearts, setHearts] = useState(false)
  const timersRef = useRef<number[]>([])
  const face = MOOD_FACE[mood]

  useEffect(
    () => () => timersRef.current.forEach((id) => window.clearTimeout(id)),
    [],
  )

  const pat = useCallback(() => {
    if (bouncing) return
    setBouncing(true)
    setHearts(true)
    timersRef.current.push(
      window.setTimeout(() => setBouncing(false), 900),
      window.setTimeout(() => setHearts(false), 1400),
    )
  }, [bouncing])

  return (
    <Box
      onClick={pat}
      title={t('shared.labels.mascotPat')}
      sx={{
        position: 'relative',
        width: 58,
        flexShrink: 0,
        cursor: 'pointer',
        userSelect: 'none',
        animation: bouncing ? `${mascotBounce} 0.9s ease` : 'none',
      }}
    >
      <svg viewBox="0 0 120 120" width="100%" role="img">
        {/* 旋转小螺旋桨(仅在线时转) */}
        <g
          style={{
            transformOrigin: '60px 22px',
            animation:
              mood === 'happy' ? `${bodySpin} 2.2s linear infinite` : 'none',
          }}
        >
          <rect x="57" y="10" width="6" height="12" rx="3" fill="#9aa3b2" />
          <ellipse
            cx="60"
            cy="10"
            rx="22"
            ry="5.5"
            fill="#5b6479"
            opacity="0.9"
          />
        </g>
        <circle cx="60" cy="22" r="4.5" fill="#3C3C43" />
        {/* 盾牌身体 */}
        <path
          d="M60 30 L96 42 L96 68 C96 92 82 106 60 114 C38 106 24 92 24 68 L24 42 Z"
          fill="#15181d"
        />
        {/* 脸 */}
        {face.eyes === 'circle' ? (
          <>
            <circle cx="48" cy="66" r="5.5" fill="#ffffff" />
            <circle cx="74" cy="66" r="5.5" fill="#ffffff" />
          </>
        ) : (
          <>
            <path
              d="M42 64 L52 68 L42 72"
              stroke="#ffffff"
              strokeWidth="3.4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M80 64 L70 68 L80 72"
              stroke="#ffffff"
              strokeWidth="3.4"
              fill="none"
              strokeLinecap="round"
            />
          </>
        )}
        {face.mouth === 'smile' && (
          <path
            d="M48 82 Q60 92 74 82"
            stroke="#ffffff"
            strokeWidth="3.6"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {face.mouth === 'flat' && (
          <path
            d="M50 86 L72 86"
            stroke="#ffffff"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        )}
        {face.mouth === 'frown' && (
          <path
            d="M48 90 Q60 81 74 90"
            stroke="#ffffff"
            strokeWidth="3.6"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {/* 腮红 */}
        <circle cx="38" cy="76" r="5" fill="#FC9B76" opacity="0.55" />
        <circle cx="84" cy="76" r="5" fill="#FC9B76" opacity="0.55" />
      </svg>

      {/* 点它冒小心心 */}
      {hearts && (
        <Box
          sx={{
            position: 'absolute',
            top: -6,
            left: 6,
            right: 6,
            pointerEvents: 'none',
          }}
        >
          {HEARTS.map((heart) => (
            <Box
              key={`heart-${heart.x}-${heart.delay}`}
              sx={{
                position: 'absolute',
                left: heart.x,
                top: 0,
                animation: `${heartFloat} 1.1s ease-out ${heart.delay}s both`,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16">
                <path
                  d="M8 14 C3.6 10.8 1.5 8.4 1.5 5.6 C1.5 3.6 3 2 5 2 C6.2 2 7.4 2.8 8 3.9 C8.6 2.8 9.8 2 11 2 C13 2 14.5 3.6 14.5 5.6 C14.5 8.4 12.4 10.8 8 14 Z"
                  fill="#FF3B66"
                />
              </svg>
            </Box>
          ))}
        </Box>
      )}

      {message && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.5,
            textAlign: 'center',
            color: 'text.secondary',
            whiteSpace: 'normal',
          }}
        >
          {message}
        </Typography>
      )}
    </Box>
  )
}
