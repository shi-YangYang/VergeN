import { useEffect, useRef } from 'react'

import {
  enterpriseDingtalkQrCancel,
  enterpriseDingtalkQrPoll,
  enterpriseDingtalkQrStart,
  enterpriseHeartbeat,
  enterpriseLogin,
  enterpriseLogout,
  enterpriseSelectSubscription,
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
  selectSubscription: (url: string) =>
    mutate(() => enterpriseSelectSubscription(url), {
      id: 'enterprise-select-subscription',
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

/** Periodic employee heartbeat; the backend derives version and platform.
 *  The first beat fires as soon as a session turns authenticated, so a
 *  device restored from disk provisions the managed profile without a
 *  five minute wait. */
export const useEnterpriseHeartbeat = () => {
  const session = useEnterpriseSession()
  const sessionRef = useRef(session)
  sessionRef.current = session
  const authenticated = session?.authenticated ?? false

  useEffect(() => {
    if (!authenticated) return
    const beat = async () => {
      if (!sessionRef.current?.authenticated) return
      try {
        const ok = await enterpriseHeartbeat()
        if (!ok) {
          await revalidateQueries([SESSION_KEY])
        }
      } catch {
        // transient network errors are ignored until the next tick
      }
    }
    void beat()
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [authenticated])
}
