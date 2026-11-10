import { describe, expect, it } from 'vitest'
import { isNewerNotificationMarker, toNotificationMarker } from './notification-unread-marker'

const at = (iso: string) => ({ latestId: 1, latestAt: iso })

describe('notification marker', () => {
  it('parses the payload and treats an empty inbox as null', () => {
    expect(toNotificationMarker({ latestId: 0, latestAt: null })).toBeNull()
    expect(toNotificationMarker({ latestId: 3, latestAt: 'not a date' })).toBeNull()
    expect(toNotificationMarker({ latestId: 3, latestAt: '2026-11-11T00:00:00Z' })).toEqual({ id: 3, at: Date.parse('2026-11-11T00:00:00Z') })
  })

  it('only records the baseline on the first value', () => {
    // SSE 连上时先推一次当前状态：不能当成新通知
    expect(isNewerNotificationMarker(undefined, toNotificationMarker(at('2026-11-11T00:00:00Z')))).toBe(false)
  })

  it('alerts when a like joins an existing unread group (new row, same group count)', () => {
    const previous = { id: 10, at: 1000 }
    expect(isNewerNotificationMarker(previous, { id: 11, at: 2000 })).toBe(true)
  })

  it('alerts when a folded thread row gets a new reply (same id, newer activity)', () => {
    expect(isNewerNotificationMarker({ id: 10, at: 1000 }, { id: 10, at: 5000 })).toBe(true)
  })

  it('does not alert when nothing changed or the latest item went away', () => {
    expect(isNewerNotificationMarker({ id: 10, at: 1000 }, { id: 10, at: 1000 })).toBe(false)
    // 取消点赞：最新一条变成更早的那条
    expect(isNewerNotificationMarker({ id: 11, at: 2000 }, { id: 10, at: 1000 })).toBe(false)
    expect(isNewerNotificationMarker({ id: 11, at: 2000 }, null)).toBe(false)
  })

  it('alerts on the first notification of an empty inbox', () => {
    expect(isNewerNotificationMarker(null, { id: 1, at: 1000 })).toBe(true)
  })
})
