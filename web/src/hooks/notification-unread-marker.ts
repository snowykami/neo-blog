import type { NotificationUnreadCount } from '@/models/notification'

/**
 * 最近一条通知的标记：后端按最近活动时间取收件人最新的一条（折叠行有新回复时活动时间会刷新）。
 * 「来了新通知」看它有没有变新，而不是看未读组数有没有变大：
 * 点赞并入已有的未读组、折叠行来了新回复时组数都不变，取消点赞反而会让最新一条变旧
 */
export interface NotificationMarker {
  id: number
  at: number
}

// toNotificationMarker 未读接口 / SSE 负载里的 latestId、latestAt → 标记；没有任何通知时为 null
export function toNotificationMarker(payload: Pick<NotificationUnreadCount, 'latestId' | 'latestAt'>): NotificationMarker | null {
  if (!payload.latestId || !payload.latestAt)
    return null
  const at = Date.parse(payload.latestAt)
  if (Number.isNaN(at))
    return null
  return { id: payload.latestId, at }
}

/**
 * isNewerNotificationMarker 是否该提示「来了新通知」。
 * previous 为 undefined 表示还没有基线（页面刚加载、刚登录）：第一次拿到的值只当基线，不提示，
 * 否则 SSE 连上时推的当前状态会被误当成新通知
 */
export function isNewerNotificationMarker(previous: NotificationMarker | null | undefined, next: NotificationMarker | null): boolean {
  if (previous === undefined || next === null)
    return false
  if (previous === null)
    return true
  return next.at > previous.at || (next.at === previous.at && next.id > previous.id)
}
