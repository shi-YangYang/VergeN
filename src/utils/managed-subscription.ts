import type { EnterpriseSession } from '@/services/cmds'

type ProfileSource = Pick<IProfileItem, 'uid' | 'type' | 'url'>

const normalizedUrl = (url: string) => url.trim().replace(/\/+$/, '')

export const isManagedSubscriptionProfile = (
  profile: ProfileSource | null | undefined,
  session: EnterpriseSession | undefined,
): boolean => {
  if (!profile || !session) return false
  if (profile.uid === session.profile_uid) return true
  if (profile.type !== 'remote' || !profile.url) return false
  const url = normalizedUrl(profile.url)
  return session.subscriptions.some(
    (subscription) => normalizedUrl(subscription.url) === url,
  )
}
