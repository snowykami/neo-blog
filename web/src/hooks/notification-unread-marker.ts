import type { NotificationUnreadCount } from '@/models/notification'

/**
 * 最近一条通知的标记：同时记录历史最大通知 ID / 活动时间上界与当前最新未读预览状态，
 * 用于精准判定「是否真的来了新未读通知」：
 * - 同日多人点赞并入同一分组时（total 不变，新明细 id / aggregateCount 递增）正常弹窗
 * - 同日线程折叠回复在同秒内再次回复时（id 不变，aggregateCount / seq 递增）正常弹窗
 * - 跨标签页标已读或取消点赞（latest 变为 null 或回退到更早的旧未读通知）绝不误弹窗
 */
export interface NotificationMarker {
  id: number
  at: number
  seq?: number
  unreadId?: number
  unreadAt?: number
  unreadAggregateCount?: number
  hasUnread?: boolean
}

export type NotificationMarkerInput = Pick<NotificationUnreadCount, 'latestId' | 'latestAt'>
  & Partial<Pick<NotificationUnreadCount, 'seq' | 'latest' | 'total'>>

// toNotificationMarker 未读接口 / SSE 负载 → 标记；没有任何通知时为 null
export function toNotificationMarker(payload: NotificationMarkerInput): NotificationMarker | null {
  const hasRichFields = 'latest' in payload || 'total' in payload
  if (hasRichFields) {
    const latest = payload.latest ?? null
    if (latest && !latest.isRead) {
      const unreadAt = Date.parse(latest.activityAt)
      const parsedLatestAt = payload.latestAt ? Date.parse(payload.latestAt) : Number.NaN
      const safeUnreadAt = Number.isNaN(unreadAt) ? 0 : unreadAt
      const maxAt = Number.isNaN(parsedLatestAt) ? safeUnreadAt : Math.max(parsedLatestAt, safeUnreadAt)
      if (!maxAt && !latest.id)
        return null
      return {
        id: Math.max(payload.latestId || 0, latest.id),
        at: maxAt,
        seq: payload.seq ?? 0,
        unreadId: latest.id,
        unreadAt: safeUnreadAt,
        unreadAggregateCount: Math.max(1, latest.aggregateCount || 1),
        hasUnread: true,
      }
    }
    if (!payload.latestId || !payload.latestAt)
      return null
    const at = Date.parse(payload.latestAt)
    if (Number.isNaN(at))
      return null
    return {
      id: payload.latestId,
      at,
      seq: payload.seq ?? 0,
      unreadId: 0,
      unreadAt: 0,
      unreadAggregateCount: 0,
      hasUnread: false,
    }
  }

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
  if (next.hasUnread === false)
    return false
  if (previous === null)
    return true

  if (next.hasUnread === true) {
    const nextId = next.unreadId ?? next.id
    const nextAt = next.unreadAt ?? next.at
    const nextCount = next.unreadAggregateCount ?? 1
    if (nextAt > previous.at || nextId > previous.id)
      return true
    if (previous.unreadId === nextId && nextCount > (previous.unreadAggregateCount ?? 1))
      return true
    if (previous.hasUnread === false && nextId === previous.id && nextAt >= previous.at && (next.seq ?? 0) > (previous.seq ?? 0))
      return true
    return false
  }

  return next.at > previous.at || (next.at === previous.at && next.id > previous.id)
}

/**
 * advanceNotificationMarker 单调推进基线：
 * 保留已见过的最大 id / at（防止标已读或取消点赞回退基线导致旧未读被误判为新通知），
 * 同时刷新当前最新未读状态与 seq。
 */
export function advanceNotificationMarker(
  previous: NotificationMarker | null | undefined,
  next: NotificationMarker | null,
): NotificationMarker | null {
  if (previous === undefined || previous === null)
    return next
  if (next === null) {
    return previous.hasUnread !== undefined
      ? { ...previous, unreadId: 0, unreadAt: 0, unreadAggregateCount: 0, hasUnread: false }
      : previous
  }
  return {
    id: Math.max(previous.id, next.id),
    at: Math.max(previous.at, next.at),
    seq: Math.max(previous.seq ?? 0, next.seq ?? 0),
    unreadId: next.unreadId,
    unreadAt: next.unreadAt,
    unreadAggregateCount: next.unreadAggregateCount,
    hasUnread: next.hasUnread,
  }
}
