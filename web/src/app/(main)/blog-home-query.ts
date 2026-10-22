import type { OrderBy } from '@/models/common'
import type { Post } from '@/models/post'

// 服务端预取的首屏文章，参数与客户端默认查询一致时直接使用，避免首屏空白和重复请求
export interface BlogHomeInitialData {
  key: string
  posts: Post[]
  total: number
}

// 列表查询参数的唯一标识，服务端与客户端共用，用于判断预取结果能否复用
export function blogHomeQueryKey(params: { page: number, label?: string | null, category?: string | null, query?: string | null, orderBy: OrderBy }) {
  return [params.page, params.label ?? '', params.category ?? '', params.query ?? '', params.orderBy].join('|')
}
