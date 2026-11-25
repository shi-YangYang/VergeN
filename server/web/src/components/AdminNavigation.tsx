import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import BottomNavigation from '@mui/material/BottomNavigation'
import BottomNavigationAction from '@mui/material/BottomNavigationAction'
import Collapse from '@mui/material/Collapse'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import { Link } from 'react-router-dom'

import {
  RELEASE_SECTIONS,
  type ReleaseSection,
} from '../features/releases/release-sections'

import { NAV, sections, tabKeys, type Tab } from './admin-navigation-model'

const phoneTabs = ['dashboard', 'users', 'clients'] as const

export function AdminNavigation({
  tab,
  section,
  phone,
  expanded,
  onToggle,
  onNavigate,
}: {
  tab: Tab
  section: ReleaseSection
  phone: boolean
  expanded: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  return (
    <List component="nav" aria-label="运维导航" className="sidebar-links">
      {tabKeys
        .filter((key) => !phone || (key !== 'dashboard' && key !== 'users'))
        .map((key) => {
          const { icon: Icon, label } = NAV[key]
          if (key === 'clients')
            return (
              <div key={key}>
                <ListItemButton
                  component="button"
                  type="button"
                  className="nav-group"
                  aria-controls="client-subnav"
                  aria-expanded={expanded}
                  onClick={onToggle}
                >
                  <ListItemIcon>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={label} />
                  {expanded ? <ExpandLess /> : <ExpandMore />}
                </ListItemButton>
                <Collapse in={expanded} id="client-subnav" unmountOnExit>
                  <List
                    component="div"
                    disablePadding
                    className="client-subnav"
                  >
                    {sections.map((key) => (
                      <ListItemButton
                        key={key}
                        component={Link}
                        to={'/admin/clients/' + key}
                        selected={tab === 'clients' && key === section}
                        aria-current={
                          tab === 'clients' && key === section
                            ? 'page'
                            : undefined
                        }
                        onClick={onNavigate}
                      >
                        <ListItemText primary={RELEASE_SECTIONS[key]} />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
              </div>
            )
          return (
            <ListItemButton
              key={key}
              component={Link}
              to={'/admin/' + key}
              selected={tab === key}
              aria-current={tab === key ? 'page' : undefined}
              onClick={onNavigate}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          )
        })}
    </List>
  )
}

export function PhoneNavigation({
  tab,
  menu,
  openMenu,
  onNavigate,
}: {
  tab: Tab
  menu: boolean
  openMenu: (clients: boolean) => void
  onNavigate: () => void
}) {
  return (
    <BottomNavigation
      component="nav"
      aria-label="快捷导航"
      className="phone-navigation"
      showLabels
      value={!menu && phoneTabs.some((key) => key === tab) ? tab : 'more'}
    >
      {phoneTabs.map((key) => {
        const Icon = NAV[key].icon
        const props =
          key === 'clients'
            ? {
                onClick: () => openMenu(true),
                'aria-haspopup': 'dialog' as const,
              }
            : { component: Link, to: '/admin/' + key, onClick: onNavigate }
        return (
          <BottomNavigationAction
            key={key}
            value={key}
            label={key === 'users' ? '员工' : NAV[key].label}
            icon={<Icon />}
            aria-current={tab === key ? 'page' : undefined}
            {...props}
          />
        )
      })}
      <BottomNavigationAction
        value="more"
        label="更多"
        icon={<MoreHorizRounded />}
        aria-haspopup="dialog"
        aria-expanded={menu}
        onClick={() => openMenu(false)}
      />
    </BottomNavigation>
  )
}
