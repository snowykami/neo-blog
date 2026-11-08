import type { TargetType } from './types'
import type { User } from './user'

export interface Comment {
  id: number
  targetType: TargetType
  targetId: number
  content: string
  language: string // 评论语言（AI 翻译时识别），未知时为空
  replyId: number
  rootId: number // 线程根评论ID：通知深链据此定位整条线程
  depth: number
  isPrivate: boolean
  createdAt: string
  updatedAt: string
  user: User
  replyCount: number
  likeCount: number
  isLiked: boolean
  os: string
  browser: string
  location: CommentLocation
  showClientInfo: boolean
  attachments?: CommentAttachment[] // 附件按添加顺序展示在正文之后，已删除的文件不返回
  // 正文里被 @ 的用户；正文本身仍是 @用户名 纯文本
  mentionUserIds?: number[]
  // 被 @ 的人的当前用户名与昵称：渲染以它为准（用户改名后显示新名字）
  mentions?: CommentMention[]
  // 只在主评论列表中返回：整个回复线程（不限层级）中可见的回复数，以及最早回复的几位用户
  threadCount?: number
  threadUsers?: User[]
}

// 评论里被 @ 的人：提交时只带 id，读回来时带当前用户名与昵称
export interface CommentMention {
  id: number
  username: string
  nickname: string
}

// 评论附件：站内文件
export interface CommentAttachment {
  id: number // 文件 ID
  url: string
  name: string
  mimeType: string
  size: number
}

export interface CommentLocation {
  country: string
  province: string
  city: string
  districts: string
  isp: string
  idc: string
}

// 评论所属的文章或页面
export interface CommentTarget {
  id: number
  type: TargetType
  title: string
  slug: string | null
}

// 用户主页的评论条目，附带所属目标信息
export interface UserComment extends Comment {
  target: CommentTarget
}

// 评论的 AI 译文
export interface CommentTranslation {
  commentId: number
  sourceLang: string // AI 识别出的源语言
  targetLang: string
  content: string // 译文；源语言与目标语言相同时为空
  sameLanguage: boolean // 评论已是目标语言，无需翻译
}
