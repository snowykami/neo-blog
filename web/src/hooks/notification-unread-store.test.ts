import type { NotificationUnreadCount } from '@/models/notification'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decreaseUnreadSnapshot,
  getUnreadSnapshot,
  nextSseRetryDelay,
  registerUnreadRefresher,
  requestUnreadRefresh,
  setUnreadSnapshot,
  SSE_RETRY_MAX_MS,
  SSE_RETRY_MIN_MS,
  subscribeUnreadSnapshot,
} from './notification-unread-store'

function payload(total: number): NotificationUnreadCount {
  return { total, byType: {}, latestId: 3, latestAt: '2026-11-11T00:00:00Z' }
}

afterEach(() => setUnreadSnapshot(null))

describe('notification unread store', () => {
  it('notifies subscribers when the snapshot changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeUnreadSnapshot(listener)
    setUnreadSnapshot({ userId: 1, payload: payload(2) })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setUnreadSnapshot(null)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('decreases the count optimistically only for the same account and never below zero', () => {
    setUnreadSnapshot({ userId: 1, payload: payload(2) })
    decreaseUnreadSnapshot(2, 1)
    expect(getUnreadSnapshot()?.payload.total).toBe(2)
    decreaseUnreadSnapshot(1, 1)
    expect(getUnreadSnapshot()?.payload.total).toBe(1)
    decreaseUnreadSnapshot(1, 5)
    expect(getUnreadSnapshot()?.payload.total).toBe(0)
    expect(getUnreadSnapshot()?.payload.latestId).toBe(3)
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
