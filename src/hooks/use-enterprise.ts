import { useEffect, useRef } from 'react'

import {
  enterpriseDingtalkQrCancel,
  enterpriseDingtalkQrPoll,
  enterpriseDingtalkQrStart,
  enterpriseHeartbeat,
  enterpriseLogin,
  enterpriseLogout,
  enterpriseSync,
  getEnterpriseSession,
  type EnterpriseSession,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import {
  revalidateQueries,
  setCacheData,
  useQuery,
} from '@/services/query-client'

const SESSION_KEY = ['getEnterpriseSession'] as const

export const useEnterpriseSession = () => {
  const { data: session } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: getEnterpriseSession,
    staleTime: 5000,
  })
  return session
}

const cacheSession = (session: EnterpriseSession) => {
  setCacheData<EnterpriseSession>(SESSION_KEY, session)
}

export const enterpriseActions = {
  login: (serverUrl: string, username: string, password: string) =>
    mutate(() => enterpriseLogin(serverUrl, username, password), {
      id: 'enterprise-login',
      onFulfilled: cacheSession,
    }),
  logout: () =>
    mutate(() => enterpriseLogout(), {
      id: 'enterprise-logout',
      onFulfilled: cacheSession,
    }),
  sync: () =>
    mutate(() => enterpriseSync(), {
      id: 'enterprise-sync',
      onFulfilled: cacheSession,
    }),
  dingtalkQrStart: (serverUrl: string) =>
    mutate(() => enterpriseDingtalkQrStart(serverUrl), {
      id: 'enterprise-qr-start',
    }),
  dingtalkQrPoll: (serverUrl: string, sessionId: string) =>
    mutate(() => enterpriseDingtalkQrPoll(serverUrl, sessionId), {
      id: 'enterprise-qr-poll',
    }),
  completeQrLogin: () =>
    mutate(() => getEnterpriseSession(), {
      id: 'enterprise-qr-complete',
      onFulfilled: cacheSession,
    }),
  cancelQr: (serverUrl: string, sessionId: string) =>
    enterpriseDingtalkQrCancel(serverUrl, sessionId),
}

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000

/** Periodic employee heartbeat; the backend derives version and platform. */
export const useEnterpriseHeartbeat = () => {
  const session = useEnterpriseSession()
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (!sessionRef.current?.authenticated) return
      try {
        const ok = await enterpriseHeartbeat()
        if (!ok) {
          await revalidateQueries([SESSION_KEY])
        }
      } catch {
        // transient network errors are ignored until the next tick
      }
    }, HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])
}
