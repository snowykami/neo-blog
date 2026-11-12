import type { BaseResponse } from '@/models/resp'
import type { GlobalSearchResult } from '@/models/search'
import axiosClient from './client'

/** 全站公开资源聚合搜索（文章、独立页面、公开评论、候选用户），支持拼音与首字母检索 */
export async function globalSearch({
  q,
  limit = 5,
  types,
  signal,
}: {
  q: string
  limit?: number
  types?: string
  signal?: AbortSignal
}): Promise<BaseResponse<GlobalSearchResult>> {
  const res = await axiosClient.get('/search', {
    params: { q, limit, types },
    signal,
  })
  return res.data
}
