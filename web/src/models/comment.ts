import type { TargetType } from './types'
import type { User } from './user'

export interface Comment {
  id: number
  targetType: TargetType
  targetId: number
  content: string
  replyId: number
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
