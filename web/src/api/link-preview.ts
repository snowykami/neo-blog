import type { LinkPreview } from '@/models/link-preview'
import type { BaseResponse } from '@/models/resp'
import axiosClient from './client'

export type LinkPreviewTargetType = 'post' | 'page' | 'sidebar'

export interface GetLinkPreviewParams {
  url: string
  targetType?: LinkPreviewTargetType
  targetId?: number
}

// 外链预览由后端统一抓取并缓存（Redis / 内存），访客按公开内容 URL 白名单访问
export async function getLinkPreview({ url, targetType, targetId }: GetLinkPreviewParams): Promise<LinkPreview> {
  const res = await axiosClient.get<BaseResponse<LinkPreview>>('/misc/link-preview', {
    params: {
      url,
      ...(targetType ? { targetType } : {}),
      ...(targetId ? { targetId } : {}),
    },
  })
  return res.data.data
}
