import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

import { useProxiesData } from '@/providers/app-data-context'
import { AppDataProvider } from '@/providers/app-data-provider'

const fixture = vi.hoisted(() => ({
  current: 'A',
  key: '',
  cache: new Map<string, unknown>(),
  read: () => Promise.resolve(),
  core: vi.fn(),
}))

vi.mock('@/hooks/use-profiles', () => ({
  useProfiles: () => ({ profiles: { current: fixture.current } }),
}))
vi.mock('@/hooks/use-clash', () => ({
  useClashInfo: () => ({}),
  useRuntimeConfig: () => ({}),
}))
vi.mock('@/hooks/use-verge', () => ({ useVerge: () => ({}) }))
vi.mock('@/hooks/use-enterprise', () => ({ useEnterpriseHeartbeat: vi.fn() }))
vi.mock('@/store/app-store-context', () => ({ useRunState: vi.fn() }))
vi.mock('tauri-plugin-mihomo-api', () => ({
  getBaseConfig: vi.fn(),
  getRuleProviders: vi.fn(),
  getRules: vi.fn(),
}))
vi.mock('@/services/cmds', () => ({
  getProxyView: fixture.core,
  getSystemProxy: vi.fn(),
}))
vi.mock('@/services/query-client', () => ({
  useQuery: (options: { queryKey: string[]; queryFn: () => Promise<void> }) => {
    const key = JSON.stringify(options.queryKey)
    if (options.queryKey[0] === 'getProxyView') {
      fixture.key = key
      fixture.read = options.queryFn
    }
    return {
      data: fixture.cache.get(key),
      isPending: !fixture.cache.has(key),
      refetch: vi.fn(),
    }
  },
}))

function List() {
  const { proxyView, isProxyViewPending } = useProxiesData()
  return isProxyViewPending ? 'loading' : (proxyView?.groups[0]?.now ?? 'empty')
}

const page = () =>
  renderToStaticMarkup(
    createElement(AppDataProvider, null, createElement(List)),
  )
const snapshot = (id: string) => ({
  profileUid: id,
  groups: [{ name: 'Selector', now: 'Node-' + id }],
})

it('does not present or cache the previous subscription as the newly applied one', async () => {
  page()
  const keyA = fixture.key
  fixture.cache.set(keyA, snapshot('A'))
  expect(page()).toBe('Node-A')

  fixture.current = 'B'
  expect(page()).toBe('loading')
  const keyB = fixture.key
  expect(keyB).not.toBe(keyA)
  fixture.core.mockResolvedValueOnce(snapshot('A'))
  await expect(fixture.read()).rejects.toThrow()

  fixture.core.mockResolvedValueOnce(snapshot('B'))
  fixture.cache.set(keyB, await fixture.read())
  fixture.cache.set(keyA, snapshot('A')) // A read completes late.
  expect(page()).toBe('Node-B')
})
