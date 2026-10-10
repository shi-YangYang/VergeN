import type { CompanySubscription } from '@/services/cmds'

import { useEnterpriseSession } from './use-enterprise'

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
