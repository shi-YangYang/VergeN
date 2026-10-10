import type { Update } from '@tauri-apps/plugin-updater'
import { compareVersions as compareSemver } from 'compare-versions'

import { enterpriseReleaseCurrent } from '@/services/cmds'
import { fetchCacheData, setCacheData, useQuery } from '@/services/query-client'
import { checkUpdateSafe } from '@/services/update'
import { version as appVersion } from '@root/package.json'

import { useEnterpriseSession } from './use-enterprise'
import { useVerge } from './use-verge'

const LAST_CHECK_KEY = 'last_check_update'

export const readLastCheckTime = (): number | null => {
  const stored = localStorage.getItem(LAST_CHECK_KEY)
  if (!stored) return null
  const ts = parseInt(stored, 10)
  return isNaN(ts) ? null : ts
}

export const updateLastCheckTime = (timestamp?: number): number => {
  const now = timestamp ?? Date.now()
  localStorage.setItem(LAST_CHECK_KEY, now.toString())
  setCacheData([LAST_CHECK_KEY], now)
  return now
}

/** Company releases surface as a plain manifest; check() supplies the rest. */
export interface CompanyUpdateInfo {
  available: true
  kind: 'company'
  version: string
  notes: string
  url: string
  pub_date: number
}

type AppUpdateInfo = {
  kind: 'app'
  available: boolean
  version: string
  date?: string
  body?: string
}

export type UpdateInfo = CompanyUpdateInfo | AppUpdateInfo

export const isCompanyUpdate = (
  info: UpdateInfo | null | undefined,
): info is CompanyUpdateInfo => info?.kind === 'company'

const checkUpdateChannel = async (): Promise<UpdateInfo | null> => {
  const release = await enterpriseReleaseCurrent()
  if (!release) return null
  let newer: boolean
  try {
    newer = compareSemver(release.version, appVersion) > 0
  } catch {
    newer = release.version !== appVersion
  }
  if (!newer) return null
  return {
    available: true,
    kind: 'company',
    version: release.version,
    notes: release.notes,
    url: release.url,
    pub_date: release.pub_date,
  }
}

export const useUpdate = (enabled: boolean = true) => {
  const { verge } = useVerge()
  const session = useEnterpriseSession()
  const { auto_check_update } = verge || {}

  const shouldCheck = enabled && auto_check_update !== false

  const fetchUpdate = async (): Promise<UpdateInfo | null> => {
    if (session?.authenticated) {
      return checkUpdateChannel()
    }
    const result = await checkUpdateSafe()
    if (!result) return null
    const update: Update = result
    return {
      kind: 'app',
      available: update.available,
      version: update.version,
      date: update.date,
      body: update.body,
    }
  }

  const { data: updateInfo, isFetching: isValidating } = useQuery({
    queryKey: ['checkUpdate', session?.authenticated],
    queryFn: fetchUpdate,
    enabled: shouldCheck,
    retry: 2,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 24 * 60 * 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })

  const checkUpdate = async () => {
    const data = await fetchCacheData(
      ['checkUpdate', session?.authenticated],
      fetchUpdate,
    )
    return { data }
  }

  const { data: lastCheckUpdate } = useQuery({
    queryKey: [LAST_CHECK_KEY],
    queryFn: readLastCheckTime,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    updateInfo,
    checkUpdate,
    loading: isValidating,
    lastCheckUpdate: lastCheckUpdate ?? null,
  }
}
