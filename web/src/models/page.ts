import type { User } from './user'

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
  createdAt: string
  updatedAt: string
}
