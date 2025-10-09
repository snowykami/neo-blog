import type { Category } from './category'
import type { User } from './user'
import type { Label } from '@/models/label'

export interface Post {
  id: number
  // 可编辑字段
  title: string
  slug: string | null
  content: string
  description: string // 描述
  draftContent: string | null // 草稿内容，仅在请求草稿时返回
  cover: string | null // 封面可以为空
  category: Category | null // 分类可以为空
  categoryId: number | null // 分类 ID，可以为空
  labels: Label[] | null // 标签可以为空
  labelIds: number[] | null // 标签 ID 列表，可以为空
  type: 'markdown' | 'html' // 文章类型，markdown 或 html
  // 不可编辑字段
  user: User
  isLiked: boolean // 当前用户是否点赞
  isPrivate: boolean
  likeCount: number
  commentCount: number
  viewCount: number
  heat: number
  createdAt: string
  updatedAt: string
}

export interface ListPostsParams {
  page?: number
  size?: number
  orderBy?: string
  desc?: boolean
  keywords?: string
}
