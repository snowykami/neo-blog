import type { PageLayout } from './page'
import type { User } from './user'

// 版本类型：发布 / 打开编辑器时（编辑起点）/ 自动保存的检查点 / 恢复或放弃修改前的备份
export type RevisionKind = 'publish' | 'session' | 'autosave' | 'backup'

// 受保护（不能删除、不会被自动清理）的原因：当前发布的版本 / 最新版本（当前草稿）/ 当前编辑会话的编辑起点
export type RevisionProtected = 'published' | 'latest' | 'base'

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
  apiTokenName?: string // 通过个人 API Token（外部 AI 工具）写入时为 Token 名称
  protected?: RevisionProtected // 仅列表返回
}

export interface RevisionDetail extends Revision {
  content: string
  meta: RevisionMeta
}

export interface RevisionList {
  revisions: Revision[]
  total: number
  maxKeep: number // 每篇最多保留的版本数，超出的旧版本自动清理
}
