import type { MisskeyFeed, MisskeyFeedQuery } from '@/models/misskey'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

/**
 * 读取后端定时刷新缓存的侧边栏 Misskey 公开动态（支持游标/偏移切片加载，纯只读缓存不触发上游同步阻塞）
 */
export async function getMisskeyFeed(params?: MisskeyFeedQuery): Promise<BaseResponse<MisskeyFeed>> {
  const res = await axiosClient.get<BaseResponse<MisskeyFeed>>('/misc/misskey/feed', { params })
  return res.data
}
