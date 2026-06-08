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
  draftContent: string | null
  type: 'markdown' | 'html'
  isPrivate: boolean
  showInNav: boolean
  navOrder: number
  createdAt: string
  updatedAt: string
}
