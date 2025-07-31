export interface PaginationParams {
    orderBy: OrderBy
    desc: boolean
    page: number
    size: number
}

export enum OrderBy {
    CreatedAt = 'created_at',
    UpdatedAt = 'updated_at',
    Heat = 'heat',
    CommentCount = 'comment_count',
    LikeCount = 'like_count',
    ViewCount = 'view_count',
}