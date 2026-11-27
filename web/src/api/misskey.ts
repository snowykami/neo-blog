import type { MisskeyFeed } from '@/models/misskey'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

/**
 * 读取后端定时刷新缓存的侧边栏 Misskey 公开动态（纯只读缓存，不触发上游同步阻塞）
 */
export async function getMisskeyFeed(): Promise<BaseResponse<MisskeyFeed>> {
  const res = await axiosClient.get<BaseResponse<MisskeyFeed>>('/misc/misskey/feed')
  return res.data
}
