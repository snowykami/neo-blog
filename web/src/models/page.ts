import type { User } from './user'

// 前台版式：reading 阅读（正文 + 目录侧边栏，外框与顶栏对齐）/ wide 宽屏（正文占满整行）
export const PAGE_LAYOUTS = ['reading', 'wide'] as const

export type PageLayout = typeof PAGE_LAYOUTS[number]

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
  createdAt: string
  updatedAt: string
}
