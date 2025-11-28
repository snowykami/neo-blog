export interface PaginationParams {
  orderBy?: OrderBy
  desc?: boolean // 是否降序
  page?: number
  size?: number
}

export enum OrderBy {
  Name = 'name', // 文章不能用 name 排序
  CreatedAt = 'created_at',
  UpdatedAt = 'updated_at',
  Heat = 'heat',
  CommentCount = 'comment_count',
  LikeCount = 'like_count',
  ViewCount = 'view_count',
  Size = 'size',
}

export enum ArrangementMode {
  Grid = 'grid',
  List = 'list',
  Card = 'card',
}

export enum SearchMode {
  All = 'all',
  Title = 'title',
  Content = 'content',
  Tag = 'tag',
}
