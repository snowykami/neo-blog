import type { User } from '@/models/user'
import type { IconType } from '@/types/icon'
import {
  ChartBarStackedIcon,
  Database,
  Folder,
  Footprints,
  Gauge,
  IdCard,
  MessageCircle,
  Newspaper,
  NotebookText,
  Palette,
  Settings,
  ShieldCheck,
  TagsIcon,
  UserPen,
  Users,
} from 'lucide-react'
import { isAdmin, isEditor } from '@/utils/common/permission'
import { consolePath } from '@/utils/common/route'

export interface SidebarItem {
  id: string
  title: string
  url: string
  icon: IconType
  permission: ({ user }: { user: User }) => boolean
}

export const sidebarData: {
  navContent: SidebarItem[]
  navPersonal: SidebarItem[]
  navSystem: SidebarItem[]
  navUser: SidebarItem[]
} = {
  navContent: [
    {
      id: 'dashboard',
      title: 'dashboard.title',
      url: consolePath.dashboard,
      icon: Gauge,
      permission: isAdmin,
    },
    {
      id: 'posts',
      title: 'posts.title',
      url: consolePath.post,
      icon: Newspaper,
      permission: isEditor,
    },
    {
      id: 'pages',
      title: 'pages.title',
      url: consolePath.page,
      icon: NotebookText,
      permission: isEditor,
    },
    {
      id: 'categories',
      title: 'categories.title',
      url: consolePath.category,
      icon: ChartBarStackedIcon,
      permission: isEditor,
    },
    {
      id: 'labels',
      title: 'labels.title',
      url: consolePath.label,
      icon: TagsIcon,
      permission: isEditor,
    },
    {
      id: 'comments',
      title: 'comments.title',
      url: consolePath.comment,
      icon: MessageCircle,
      permission: isAdmin,
    },
    {
      id: 'visits',
      title: 'visits.title',
      url: consolePath.visit,
      icon: Footprints,
      permission: isAdmin,
    },
    {
      id: 'files',
      title: 'files.title',
      url: consolePath.file,
      icon: Folder,
      permission: () => true,
    },
  ],
  navUser: [
    {
      id: 'users',
      title: 'users.title',
      url: consolePath.user,
      icon: Users,
      permission: isAdmin,
    },
    {
      id: 'oidc',
      title: 'oidc.title',
      url: consolePath.oidc,
      icon: IdCard,
      permission: isAdmin,
    },
  ],
  navSystem: [
    {
      id: 'global',
      title: 'global.title',
      url: consolePath.global,
      icon: Settings,
      permission: isAdmin,
    },
    {
      id: 'storages',
      title: 'storages.title',
      url: consolePath.storage,
      icon: Database,
      permission: isAdmin,
    },
  ],
  navPersonal: [
    {
      id: 'user_profile',
      title: 'user_profile.title',
      url: consolePath.userProfile,
      icon: UserPen,
      permission: () => true,
    },
    {
      id: 'user_security',
      title: 'user_security.title',
      url: consolePath.userSecurity,
      icon: ShieldCheck,
      permission: () => true,
    },
    {
      id: 'user_preference',
      title: 'user_preference.title',
      url: consolePath.userPreference,
      icon: Palette,
      permission: () => true,
    },
  ],
}

// 按侧栏顺序排列的全部控制台菜单项
export const allSidebarItems: SidebarItem[] = [
  ...sidebarData.navContent,
  ...sidebarData.navSystem,
  ...sidebarData.navUser,
  ...sidebarData.navPersonal,
]

/**
 * 根据路径匹配控制台菜单项；子路由（如 /console/posts/edit/1）归属于其父菜单
 * 仪表盘路径为 /console，只做精确匹配，避免吞掉所有子路由
 */
export function matchSidebarItem(pathname: string): SidebarItem | undefined {
  return allSidebarItems.find(item =>
    pathname === item.url
    || (item.url !== consolePath.dashboard && pathname.startsWith(`${item.url}/`)),
  )
}

// 当前用户有权限访问的第一个菜单项，用于无权访问仪表盘时的跳转
export function getFirstPermittedSidebarItem(user: User): SidebarItem | undefined {
  return allSidebarItems.find(item => item.permission({ user }))
}
