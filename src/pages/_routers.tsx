import { createBrowserRouter, RouteObject } from 'react-router'

import Layout from './_layout'
import { navItems } from './_navigation'
import LogsPage from './logs'
import UnlockPage from './unlock'

// Logs and unlock tests live outside the primary navigation; the settings
// page links to them as diagnostics.
const diagnosticsRoutes: RouteObject[] = [
  { path: '/logs', Component: LogsPage },
  { path: '/unlock', Component: UnlockPage },
]

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      ...navItems.map(
        (item) =>
          ({
            path: item.path,
            Component: item.Component,
          }) as RouteObject,
      ),
      ...diagnosticsRoutes,
    ],
  },
])
