import type { NotificationUnreadCount } from '@/models/notification'

/**
 * 未读通知状态的共享快照：顶栏头像里的 useUnreadNotificationCount 是唯一持有实时连接（SSE）与兜底轮询的地方，
 * 拿到的未读状态写进这里；通知页从这里读真实的未读数（「全部已读」是否可点），标记已读后在这里先把数字减下去、
 * 再请求顶栏重新取一次，头像上的小点因此立即消失，不必等实时推送或下一次轮询。
 * 快照记着属于哪个账号：切换账号后旧账号的数字不会被新账号读到
 */
export interface UnreadSnapshot {
  userId: number
  payload: NotificationUnreadCount
}

let snapshot: UnreadSnapshot | null = null
const listeners = new Set<() => void>()
const refreshers = new Set<() => void>()

function emit() {
  for (const listener of listeners)
    listener()
}

export function getUnreadSnapshot(): UnreadSnapshot | null {
  return snapshot
}

export function setUnreadSnapshot(next: UnreadSnapshot | null) {
  snapshot = next
  emit()
}

export function subscribeUnreadSnapshot(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 乐观地减少某个账号的未读数（标记已读后立即生效，随后的刷新以服务端为准）；账号不符时不动 */
export function decreaseUnreadSnapshot(userId: number, by: number) {
  if (!snapshot || snapshot.userId !== userId || by <= 0)
    return
  setUnreadSnapshot({ userId, payload: { ...snapshot.payload, total: Math.max(0, snapshot.payload.total - by) } })
}

/** 顶栏注册「重新取一次未读数」的入口，返回注销函数 */
export function registerUnreadRefresher(refresh: () => void): () => void {
  refreshers.add(refresh)
  return () => {
    refreshers.delete(refresh)
  }
}

/** 未读状态可能变了（标记已读、全部已读）：请顶栏重新取一次 */
export function requestUnreadRefresh() {
  for (const refresh of refreshers)
    refresh()
}

// 实时连接被拒绝（连接数超限的 429、服务端出错、代理不支持长连接）后浏览器不会再自动重连，由我们按退避重连
export const SSE_RETRY_MIN_MS = 5_000
export const SSE_RETRY_MAX_MS = 5 * 60_000

/** 下一次重连前的等待时间：每失败一次翻倍，封顶 SSE_RETRY_MAX_MS */
export function nextSseRetryDelay(previous: number): number {
  return Math.min(Math.max(previous, SSE_RETRY_MIN_MS / 2) * 2, SSE_RETRY_MAX_MS)
}
