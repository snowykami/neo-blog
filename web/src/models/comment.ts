import { TargetType } from "./types"
import type { User } from "./user"

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
  location: string
}
