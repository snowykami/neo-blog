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

const BROADCAST_CHANNEL_NAME = 'neo-blog:notification-unread'
let broadcastChannel: BroadcastChannel | null = null

type UnreadBroadcastMessage
  = | { type: 'snapshot', snapshot: UnreadSnapshot }
    | { type: 'clear', userId: number }

/**
 * 判断新到达的同账号快照是否比当前内存快照更旧（例如慢 HTTP 响应晚于实时 SSE 推送到达）：
 * - 后端每次通知变更都会递增 notify:seq:{uid}（24h TTL）并写入服务端 updatedAt；
 * - 若当前已有正整数 seq 且新负载 seq 更小，除非新负载服务端时间明显晚于旧负载（> 60s，跨天 TTL 过期或 Redis 重启），否则视为乱序旧数据丢弃；
 * - 序号相同时若双方均带 updatedAt 且新负载生成时间严格更早，同样视为旧数据（乐观减数保持相同 updatedAt 不会被拦截）。
 */
export function isStaleUnreadPayload(current: NotificationUnreadCount, next: NotificationUnreadCount): boolean {
  const currentSeq = current.seq ?? 0
  const nextSeq = next.seq ?? 0
  const currentUpdatedAt = current.updatedAt ? Date.parse(current.updatedAt) : Number.NaN
  const nextUpdatedAt = next.updatedAt ? Date.parse(next.updatedAt) : Number.NaN
  const hasTimestamps = !Number.isNaN(currentUpdatedAt) && !Number.isNaN(nextUpdatedAt)

  if (currentSeq > 0 && typeof next.seq === 'number' && nextSeq !== currentSeq) {
    if (nextSeq < currentSeq) {
      if (hasTimestamps && nextUpdatedAt - currentUpdatedAt > 60_000)
        return false
      return true
    }
    return false
  }

  if (hasTimestamps && nextUpdatedAt < currentUpdatedAt)
    return true

  return false
}

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined')
    return null
  if (!broadcastChannel) {
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      channel.onmessage = (event: MessageEvent<UnreadBroadcastMessage>) => {
        const message = event.data
        if (!message || typeof message !== 'object')
          return
        if (message.type === 'clear') {
          if (typeof message.userId === 'number' && snapshot && snapshot.userId === message.userId) {
            snapshot = null
            emit()
          }
          return
        }
        if (message.type !== 'snapshot' || !message.snapshot)
          return
        const incoming = message.snapshot
        if (typeof incoming.userId !== 'number' || !incoming.payload || typeof incoming.payload.total !== 'number')
          return
        // 仅同步同一当前账号的快照（或本页尚未建快照时预热），避免后台标签页各自维持长连接也能实时刷新徽标
        if (snapshot && snapshot.userId !== incoming.userId)
          return
        if (snapshot && snapshot.userId === incoming.userId && isStaleUnreadPayload(snapshot.payload, incoming.payload))
          return
        snapshot = incoming
        emit()
      }
      broadcastChannel = channel
    }
    catch {
      return null
    }
  }
  return broadcastChannel
}

function emit() {
  for (const listener of listeners)
    listener()
}

export function getUnreadSnapshot(): UnreadSnapshot | null {
  return snapshot
}

export function setUnreadSnapshot(next: UnreadSnapshot | null): boolean {
  if (next === null) {
    if (snapshot !== null) {
      snapshot = null
      emit()
    }
    return true
  }
  if (snapshot && snapshot.userId === next.userId && isStaleUnreadPayload(snapshot.payload, next.payload))
    return false
  snapshot = next
  emit()
  ensureBroadcastChannel()?.postMessage({ type: 'snapshot', snapshot: next } satisfies UnreadBroadcastMessage)
  return true
}

/** 按账号清空未读快照并同步通知同源其他标签页（登出或切换账号时调用，避免新开标签页水合期误发全局清空广播） */
export function clearUnreadSnapshot(forUserId: number) {
  if (snapshot && snapshot.userId === forUserId) {
    snapshot = null
    emit()
  }
  ensureBroadcastChannel()?.postMessage({ type: 'clear', userId: forUserId } satisfies UnreadBroadcastMessage)
}

export function subscribeUnreadSnapshot(listener: () => void): () => void {
  ensureBroadcastChannel()
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
