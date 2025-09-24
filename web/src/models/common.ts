export interface PaginationParams {
  orderBy: OrderBy
  desc: boolean // 是否降序
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