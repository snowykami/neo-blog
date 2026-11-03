import type { CommentTarget } from './comment'
import type { TargetType } from './types'
import type { User } from './user'

// 用户主页的点赞条目：点赞的文章或评论，附带作者与所在文章/页面
export interface UserLike {
  id: number
  targetType: TargetType
  targetId: number
  // 点赞时间
  createdAt: string
  // 被点赞内容的作者
  author: User
  // 评论内容，仅点赞评论时有值
  content: string
  // 点赞文章时为文章本身，点赞评论时为评论所在的文章或页面
  target: CommentTarget
}
