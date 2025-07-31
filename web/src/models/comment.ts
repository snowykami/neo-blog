import type { User } from "./user"

export interface Comment{
    id: number
    targetType: string
    targetId: number
    content: string
    replyId: number
    depth: number
    isPrivate: boolean
    createdAt: string
    updatedAt: string
    user: User
}

export interface CreateCommentRequest {
    targetType: string
    targetId: number
    content: string
    replyId?: number // 可选字段，默认为 null
    isPrivate?: boolean // 可选字段，默认为 false
}

export interface UpdateCommentRequest {
    id: number
    content: string
    isPrivate?: boolean // 可选字段，默认为 false
}