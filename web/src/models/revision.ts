import type { PageLayout } from './page'
import type { User } from './user'

// 版本类型：发布 / 打开编辑器时（编辑起点）/ 自动保存的检查点 / 恢复或放弃修改前的备份
export type RevisionKind = 'publish' | 'session' | 'autosave' | 'backup'

export interface RevisionMeta {
  title: string
  description: string
  cover: string
  slug?: string
  isPrivate: boolean
  categoryId?: number
  labelIds?: number[]
  top?: number
  showInNav?: boolean
  navOrder?: number
  layout?: PageLayout
}

export interface Revision {
  id: number
  kind: RevisionKind
  title: string
  wordCount: number
  user: User
  createdAt: string
}

export interface RevisionDetail extends Revision {
  content: string
  meta: RevisionMeta
}
