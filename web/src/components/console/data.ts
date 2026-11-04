import type { User } from '@/models/user'
import type { IconType } from '@/types/icon'
import {
  AudioLines,
  Bot,
  ChartBarStackedIcon,
  ChartPie,
  Database,
  Folder,
  Footprints,
  Gauge,
  IdCard,
  KeyRound,
  ListTree,
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

/** 控制台页面：每个页面属于一个侧边栏菜单，同一菜单下有多个页面时在内容区以 Tab 切换 */
export interface SidebarItem {
  id: string
  title: string // 页面标题（Console 下的文案键）
  tabTitle?: string // Tab 上的名称，未设置时使用 title
  url: string
  icon: IconType
  permission: ({ user }: { user: User }) => boolean
}

/** 侧边栏菜单项：有权限访问其中任一页面时显示，点击进入第一个有权限的页面 */
export interface SidebarMenu {
  id: string
  title: string
  icon: IconType
  items: SidebarItem[]
}

const dashboard: SidebarItem = { id: 'dashboard', title: 'dashboard.title', tabTitle: 'menu.overview', url: consolePath.dashboard, icon: Gauge, permission: isAdmin }
const visits: SidebarItem = { id: 'visits', title: 'visits.title', url: consolePath.visit, icon: Footprints, permission: isAdmin }
// 访客统计：推断地区、可信度、设备与语言分布
const visitInsights: SidebarItem = { id: 'visit_insights', title: 'visit_insights.title', url: consolePath.visitInsights, icon: ChartPie, permission: isAdmin }
const posts: SidebarItem = { id: 'posts', title: 'posts.title', url: consolePath.post, icon: Newspaper, permission: isEditor }
const pages: SidebarItem = { id: 'pages', title: 'pages.title', url: consolePath.page, icon: NotebookText, permission: isEditor }
const categories: SidebarItem = { id: 'categories', title: 'categories.title', url: consolePath.category, icon: ChartBarStackedIcon, permission: isEditor }
const labels: SidebarItem = { id: 'labels', title: 'labels.title', url: consolePath.label, icon: TagsIcon, permission: isEditor }
const comments: SidebarItem = { id: 'comments', title: 'comments.title', url: consolePath.comment, icon: MessageCircle, permission: isAdmin }
// 歌词特效（AI 歌词标注的查看与手动编辑）：标注对所有读者生效，限管理员
const lyricEffects: SidebarItem = { id: 'lyric_effects', title: 'lyric_effects.title', url: consolePath.lyricEffect, icon: AudioLines, permission: isAdmin }
const files: SidebarItem = { id: 'files', title: 'files.title', tabTitle: 'menu.files', url: consolePath.file, icon: Folder, permission: () => true }
const storages: SidebarItem = { id: 'storages', title: 'storages.title', url: consolePath.storage, icon: Database, permission: isAdmin }
const globalSettings: SidebarItem = { id: 'global', title: 'global.title', url: consolePath.global, icon: Settings, permission: isAdmin }
const users: SidebarItem = { id: 'users', title: 'users.title', url: consolePath.user, icon: Users, permission: isAdmin }
// AI 用户（由 Agent 驱动的普通账号）与行为日志：仅管理员可见
const aiAgents: SidebarItem = { id: 'ai_agents', title: 'ai_agents.title', tabTitle: 'ai_agents.tab_agents', url: consolePath.aiAgent, icon: Bot, permission: isAdmin }
const aiAgentRuns: SidebarItem = { id: 'ai_agent_runs', title: 'ai_agents.runs.title', url: consolePath.aiAgentRun, icon: ListTree, permission: isAdmin }
const oidc: SidebarItem = { id: 'oidc', title: 'oidc.title', url: consolePath.oidc, icon: IdCard, permission: isAdmin }
const userProfile: SidebarItem = { id: 'user_profile', title: 'user_profile.title', url: consolePath.userProfile, icon: UserPen, permission: () => true }
const userSecurity: SidebarItem = { id: 'user_security', title: 'user_security.title', url: consolePath.userSecurity, icon: ShieldCheck, permission: () => true }
const userPreference: SidebarItem = { id: 'user_preference', title: 'user_preference.title', url: consolePath.userPreference, icon: Palette, permission: () => true }
// 个人 API Token：所有登录用户可创建，可选的权限范围由角色决定
const apiTokens: SidebarItem = { id: 'api_tokens', title: 'api_tokens.title', url: consolePath.apiToken, icon: KeyRound, permission: () => true }

export const sidebarData: {
  navContent: SidebarMenu[]
  navSystem: SidebarMenu[]
  navPersonal: SidebarMenu[]
} = {
  navContent: [
    { id: 'dashboard', title: 'dashboard.title', icon: Gauge, items: [dashboard, visits, visitInsights] },
    { id: 'content', title: 'menu.content', icon: Newspaper, items: [posts, pages] },
    { id: 'taxonomy', title: 'menu.taxonomy', icon: TagsIcon, items: [categories, labels] },
    { id: 'comments', title: 'comments.title', icon: MessageCircle, items: [comments] },
    { id: 'music', title: 'menu.music', icon: AudioLines, items: [lyricEffects] },
    { id: 'files', title: 'files.title', icon: Folder, items: [files, storages] },
  ],
  navSystem: [
    { id: 'global', title: 'global.title', icon: Settings, items: [globalSettings] },
    { id: 'accounts', title: 'menu.accounts', icon: Users, items: [users, oidc] },
    { id: 'ai_agents', title: 'ai_agents.title', icon: Bot, items: [aiAgents, aiAgentRuns] },
  ],
  navPersonal: [
    { id: 'personal', title: 'menu.personal_settings', icon: UserPen, items: [userProfile, userSecurity, userPreference, apiTokens] },
  ],
}

const allSidebarMenus: SidebarMenu[] = [
  ...sidebarData.navContent,
  ...sidebarData.navSystem,
  ...sidebarData.navPersonal,
]

// 按侧栏顺序排列的全部控制台页面
export const allSidebarItems: SidebarItem[] = allSidebarMenus.flatMap(menu => menu.items)

/** 菜单中当前用户有权限访问的页面 */
export function permittedItems(menu: SidebarMenu, user: User): SidebarItem[] {
  return menu.items.filter(item => item.permission({ user }))
}

/**
 * 根据路径匹配控制台页面及其所属菜单；子路由（如 /console/posts/edit/1）归属于其父页面
 * 仪表盘路径为 /console，只做精确匹配，避免吞掉所有子路由；
 * 页面路径互为前缀时（如 /console/ai-agents 与 /console/ai-agents/runs）优先精确匹配，其次取最长的前缀
 */
export function matchSidebarItem(pathname: string): { menu: SidebarMenu, item: SidebarItem } | undefined {
  let matched: { menu: SidebarMenu, item: SidebarItem } | undefined
  for (const menu of allSidebarMenus) {
    for (const item of menu.items) {
      if (pathname === item.url)
        return { menu, item }
      if (item.url !== consolePath.dashboard && pathname.startsWith(`${item.url}/`) && (!matched || item.url.length > matched.item.url.length))
        matched = { menu, item }
    }
  }
  return matched
}

// 当前用户有权限访问的第一个页面，用于无权访问仪表盘时的跳转
export function getFirstPermittedSidebarItem(user: User): SidebarItem | undefined {
  return allSidebarItems.find(item => item.permission({ user }))
}
