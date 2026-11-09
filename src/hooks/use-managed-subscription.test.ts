import { expect, it, vi } from 'vitest'

import { useManagedSubscriptionLabel } from './use-managed-subscription'

const state = vi.hoisted(() => ({
  session: {
    enabled: true,
    authenticated: true,
    profile_uid: 'house',
    subscription_url: 'https://example.test/house',
    subscriptions: [{ name: 'House', url: 'https://example.test/house' }],
  },
  profiles: { current: 'house' },
  proxyView: { profileUid: 'cloud' as string | null },
}))
vi.mock('./use-enterprise', () => ({
  useEnterpriseSession: () => state.session,
}))
vi.mock('./use-profiles', () => ({
  useProfiles: () => ({ profiles: state.profiles }),
}))
vi.mock('@/providers/app-data-context', () => ({
  useProxiesData: () => ({ proxyView: state.proxyView }),
}))

it('never labels cloud nodes as house while the session or node snapshot is stale', () => {
  expect(useManagedSubscriptionLabel()).toBeNull()
  state.proxyView.profileUid = 'house'
  expect(useManagedSubscriptionLabel()).toBe('House')
  state.profiles.current = 'cloud'
  expect(useManagedSubscriptionLabel()).toBeNull()
  state.profiles.current = 'house'
  state.proxyView.profileUid = null
  expect(useManagedSubscriptionLabel()).toBeNull()
})
