import type { User } from './user'

// 前台版式：reading 阅读（正文 + 目录侧边栏，外框与顶栏对齐）/ wide 宽屏（正文占满整行）
export const PAGE_LAYOUTS = ['reading', 'wide'] as const

export type PageLayout = typeof PAGE_LAYOUTS[number]

// 页面类型：content 正文页面（用编辑器撰写）；link 链接页面，在导航中直接跳转到站内路径（/ 开头）或站外地址（新窗口打开）
export const PAGE_KINDS = ['content', 'link'] as const

export type PageKind = typeof PAGE_KINDS[number]

export interface PageModel {
  id: number
  userId: number
  user: User
  title: string
  slug: string
  description: string
  cover: string
  content: string
  draftContent?: string | null // 仅单篇草稿模式返回，列表接口不包含
  type: 'markdown' | 'html'
  isPrivate: boolean
  showInNav: boolean
  navOrder: number
  layout: PageLayout
  kind: PageKind
  linkUrl: string
  // 全屏页面：正文占满视口，顶栏收起为顶部的手势条
  fullscreen: boolean
  createdAt: string
  updatedAt: string
}
