import type { TargetType } from './types'
import type { User } from './user'

// 事件类型见后端 constant.NotificationType*；线程活动（comment.thread_replied）在界面上并入「回复」
export type NotificationType
  = | 'comment.created'
    | 'comment.replied'
    | 'post.liked'
    | 'comment.liked'
    | 'comment.thread_replied'
    | 'system.test'

// 通知列表里的一行：普通通知是它自己，点赞类是多条明细在渲染时归并的一行
export interface NotificationItem {
  // 代表行的 id：单条已读时用它，聚合行点开即整组已读
  id: number
  type: NotificationType
  actor: User
  actorIsAi: boolean
  // 聚合行里最新的两个昵称（点赞类），单条通知为空
  actorNames?: string[]
  // 组内条数：1 表示单条，> 1 表示聚合行
  aggregateCount: number

  subjectType: 'post' | 'page'
  subjectId: number
  subjectTitle: string
  subjectSlug: string
  targetType: TargetType
  targetId: number
  // 本次评论（评论 / 回复类）或线程根评论（线程活动类），用于 ?comment= 深链
  commentId: number
  excerpt: string
  quotedExcerpt: string

  isRead: boolean
  createdAt: string
  updatedAt: string
}

// 未读徽标：总数与分类型都是「聚合组」的数量
export interface NotificationUnreadCount {
  total: number
  byType: Record<string, number>
}

// 通知偏好；站点级字段用于隐藏站点没开放的类型（用户只能关不能开）
export interface NotificationPreferences {
  inapp: NotificationType[]
  email: NotificationType[]
  aiInteractions: boolean
  siteEmailEnabled: boolean
  siteEmailTypes: NotificationType[]
  availableTypes: NotificationType[]
}
