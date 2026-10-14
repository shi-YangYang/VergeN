import { useMemo } from 'react'

import { useProxiesData } from '@/providers/app-data-context'
import type { CompanySubscription } from '@/services/cmds'
import type { ManagedGroupAlias } from '@/utils/managed-group-name'

import { useEnterpriseSession } from './use-enterprise'
import { useProfiles } from './use-profiles'

/** Resolves the displayed business name (the ops-panel subscription name)
 *  of the managed subscription this device runs. Null outside managed
 *  devices or when the current pick does not exist in the enabled set. */
export const useManagedSubscriptionLabel = (): string | null => {
  const session = useEnterpriseSession()
  if (!session?.enabled || !session.authenticated) return null
  const options: CompanySubscription[] = session.subscriptions ?? []
  const current = session.subscription_url?.trim() ?? ''
  const picked = options.find((option) => option.url === current)
  if (!picked) return null
  return picked.name.trim() || picked.url
}

export const useManagedGroupAlias = (): ManagedGroupAlias | null => {
  const label = useManagedSubscriptionLabel()
  const session = useEnterpriseSession()
  const { profiles } = useProfiles()
  const { proxyView } = useProxiesData()
  const name = proxyView?.groups.find((group) => group.name !== 'GLOBAL')?.name
  const active =
    !!session?.profile_uid && profiles?.current === session.profile_uid

  return useMemo(
    () => (active && name && label && name !== label ? { name, label } : null),
    [active, name, label],
  )
}
