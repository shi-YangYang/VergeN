import { createContext, use } from 'react'

import type { AppStoreAction, AppStoreState } from './app-state'
import type { createStoreReads } from './store-reads'

export const AppStateContext = createContext<AppStoreState | null>(null)
export const AppDispatchContext =
  createContext<AppStoreActionDispatcher | null>(null)

export const AppReadsContext = createContext<ReturnType<
  typeof createStoreReads
> | null>(null)

export const useAppReads = () => {
  const reads = use(AppReadsContext)
  if (!reads) throw new Error('app store is missing its provider')
  return reads
}

export type AppStoreActionDispatcher = (action: AppStoreAction) => void

const useSelector = <T>(select: (state: AppStoreState) => T): T => {
  const state = use(AppStateContext)
  if (!state) throw new Error('app store is missing its provider')
  return select(state)
}

export const useAppDispatch = (): AppStoreActionDispatcher => {
  const dispatch = use(AppDispatchContext)
  if (!dispatch) throw new Error('app store is missing its provider')
  return dispatch
}

export const useRunState = () => useSelector((s) => s.runState)

export const usePendingFailureList = () => useSelector((s) => s.pendingFailures)

export const useSidecarFailure = () => useSelector((s) => s.sidecarFailure)

export const useTestAllCounter = () => useSelector((s) => s.testAllCounter)
