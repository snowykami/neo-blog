import type { NotificationUnreadCount } from '@/models/notification'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearUnreadSnapshot,
  decreaseUnreadSnapshot,
  getUnreadSnapshot,
  isStaleUnreadPayload,
  nextSseRetryDelay,
  registerUnreadRefresher,
  requestUnreadRefresh,
  setUnreadSnapshot,
  SSE_RETRY_MAX_MS,
  SSE_RETRY_MIN_MS,
  subscribeUnreadSnapshot,
} from './notification-unread-store'

function payload(total: number, extra: Partial<NotificationUnreadCount> = {}): NotificationUnreadCount {
  return { total, byType: {}, latestId: 3, latestAt: '2026-11-11T00:00:00Z', ...extra }
}

afterEach(() => {
  setUnreadSnapshot(null)
})

describe('notification unread store', () => {
  it('notifies subscribers when the snapshot changes and ignores redundant null resets', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeUnreadSnapshot(listener)
    setUnreadSnapshot(null)
    expect(listener).toHaveBeenCalledTimes(0)

    setUnreadSnapshot({ userId: 1, payload: payload(2) })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setUnreadSnapshot(null)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('decreases the count optimistically only for the same account and never below zero', () => {
    setUnreadSnapshot({ userId: 1, payload: payload(2, { seq: 5, updatedAt: '2026-11-11T00:01:00Z' }) })
    decreaseUnreadSnapshot(2, 1)
    expect(getUnreadSnapshot()?.payload.total).toBe(2)
    decreaseUnreadSnapshot(1, 1)
    expect(getUnreadSnapshot()?.payload.total).toBe(1)
    decreaseUnreadSnapshot(1, 5)
    expect(getUnreadSnapshot()?.payload.total).toBe(0)
    expect(getUnreadSnapshot()?.payload.latestId).toBe(3)
  })

  it('rejects out-of-order stale payloads while allowing TTL-reset sequences', () => {
    setUnreadSnapshot({
      userId: 1,
      payload: payload(1, { seq: 6, updatedAt: '2026-11-11T10:00:02.000Z' }),
    })

    // 慢 HTTP 响应带着旧 seq 晚到时必须丢弃，不能把已消掉的红点刷回去
    const acceptedStale = setUnreadSnapshot({
      userId: 1,
      payload: payload(2, { seq: 5, updatedAt: '2026-11-11T10:00:01.500Z' }),
    })
    expect(acceptedStale).toBe(false)
    expect(getUnreadSnapshot()?.payload.total).toBe(1)
    expect(getUnreadSnapshot()?.payload.seq).toBe(6)

    // 24h TTL 过期后 seq 重新从 1 起算（时间间隔 > 60s）时正常放行
    const acceptedReset = setUnreadSnapshot({
      userId: 1,
      payload: payload(3, { seq: 1, updatedAt: '2026-11-12T10:05:00.000Z' }),
    })
    expect(acceptedReset).toBe(true)
    expect(getUnreadSnapshot()?.payload.total).toBe(3)
    expect(getUnreadSnapshot()?.payload.seq).toBe(1)

    expect(
      isStaleUnreadPayload(
        payload(1, { seq: 1, updatedAt: '2026-11-11T10:00:02.000Z' }),
        payload(2, { seq: 0, updatedAt: '2026-11-11T10:00:01.000Z' }),
      ),
    ).toBe(true)
  })

  it('scopes clearUnreadSnapshot by userId and syncs BroadcastChannel messages safely', async () => {
    const peer = new BroadcastChannel('neo-blog:notification-unread')
    const peerMessages: unknown[] = []
    peer.onmessage = event => peerMessages.push(event.data)

    const listener = vi.fn()
    const unsubscribe = subscribeUnreadSnapshot(listener)

    try {
      // setUnreadSnapshot(null) 不应向其他标签页发清空广播（防止新开标签页水合期误清）
      setUnreadSnapshot({ userId: 1, payload: payload(2, { seq: 2, updatedAt: '2026-11-11T10:00:00Z' }) })
      setUnreadSnapshot(null)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(peerMessages).toEqual([
        { type: 'snapshot', snapshot: { userId: 1, payload: payload(2, { seq: 2, updatedAt: '2026-11-11T10:00:00Z' }) } },
      ])

      // 其他标签页同步同账号更新、忽略乱序旧 seq 与跨账号 clear
      setUnreadSnapshot({ userId: 1, payload: payload(2, { seq: 4, updatedAt: '2026-11-11T10:00:04Z' }) })
      peer.postMessage({ type: 'snapshot', snapshot: { userId: 1, payload: payload(5, { seq: 3, updatedAt: '2026-11-11T10:00:03Z' }) } })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(getUnreadSnapshot()?.payload.total).toBe(2)

      peer.postMessage({ type: 'snapshot', snapshot: { userId: 1, payload: payload(0, { seq: 5, updatedAt: '2026-11-11T10:00:05Z' }) } })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(getUnreadSnapshot()?.payload.total).toBe(0)

      peer.postMessage({ type: 'clear', userId: 999 })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(getUnreadSnapshot()?.userId).toBe(1)

      peer.postMessage({ type: 'clear', userId: 1 })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(getUnreadSnapshot()).toBeNull()

      // clearUnreadSnapshot(userId) 只清除对应账号并向其他标签页发送带 userId 的 clear 消息
      setUnreadSnapshot({ userId: 2, payload: payload(1, { seq: 1 }) })
      clearUnreadSnapshot(1)
      expect(getUnreadSnapshot()?.userId).toBe(2)
      clearUnreadSnapshot(2)
      expect(getUnreadSnapshot()).toBeNull()
    }
    finally {
      unsubscribe()
      peer.close()
    }
  })

  it('forwards refresh requests to registered refreshers until unregistered', () => {
    const refresh = vi.fn()
    const unregister = registerUnreadRefresher(refresh)
    requestUnreadRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    unregister()
    requestUnreadRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('backs off SSE reconnects exponentially up to the cap', () => {
    let delay = 0
    const delays: number[] = []
    for (let i = 0; i < 10; i++) {
      delay = nextSseRetryDelay(delay)
      delays.push(delay)
    }
    expect(delays[0]).toBe(SSE_RETRY_MIN_MS)
    expect(delays[1]).toBe(SSE_RETRY_MIN_MS * 2)
    expect(delays.at(-1)).toBe(SSE_RETRY_MAX_MS)
    expect(delays.every((value, index) => index === 0 || value >= delays[index - 1])).toBe(true)
  })
})
