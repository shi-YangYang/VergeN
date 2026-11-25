import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import InsertChartOutlined from '@mui/icons-material/InsertChartOutlined'
import LinkRounded from '@mui/icons-material/LinkRounded'
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded'

import {
  RELEASE_SECTIONS,
  type ReleaseSection,
} from '../features/releases/release-sections'

export const NAV = {
  dashboard: { label: 'Dashboard', icon: InsertChartOutlined },
  users: { label: '员工账号', icon: GroupsOutlined },
  subscription: { label: '订阅管理', icon: LinkRounded },
  clients: { label: '客户端管理', icon: CloudUploadOutlined },
  ios: { label: 'iOS 设置', icon: PhoneIphoneRounded },
  dingtalk: { label: '钉钉接入', icon: ContactsOutlined },
  announcement: { label: '公告管理', icon: CampaignOutlined },
} as const

export type Tab = keyof typeof NAV
export const tabKeys = Object.keys(NAV) as Tab[]
export const sections = Object.keys(RELEASE_SECTIONS) as ReleaseSection[]

export function adminPage(path: string): { tab: Tab; section: ReleaseSection } {
  const [, root, key, child] = path.split('/')
  return {
    tab:
      root === 'admin' && tabKeys.includes(key as Tab)
        ? (key as Tab)
        : 'dashboard',
    section: sections.includes(child as ReleaseSection)
      ? (child as ReleaseSection)
      : 'publish',
  }
}
