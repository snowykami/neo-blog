import { describe, expect, it } from 'vitest'
import { TargetType } from '@/models/types'
import { advanceNotificationMarker, isNewerNotificationMarker, toNotificationMarker } from './notification-unread-marker'

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

  it('alerts on same-day multi-user likes even within the same second and never false-alerts on mark read', () => {
    const t0 = '2026-11-13T10:00:00Z'
    const t1 = '2026-11-13T10:05:00Z'

    // 初始有一条较早未读 (id=9) 与当前刚到的第 1 个赞 (id=20)
    const snap1 = toNotificationMarker({
      total: 2,
      latestId: 20,
      latestAt: t1,
      seq: 1,
      latest: {
        id: 20,
        type: 'post.liked',
        aggregateCount: 1,
        targetType: TargetType.Post,
        targetId: 5,
        isRead: false,
        activityAt: t1,
      },
    })
    let baseline = advanceNotificationMarker(undefined, snap1)

    // 同一秒内第 2 个人给同一文章点赞：total 仍为 2，时间也是 t1，但 id=21、aggregateCount=2
    const snap2 = toNotificationMarker({
      total: 2,
      latestId: 21,
      latestAt: t1,
      seq: 2,
      latest: {
        id: 21,
        type: 'post.liked',
        aggregateCount: 2,
        targetType: TargetType.Post,
        targetId: 5,
        isRead: false,
        activityAt: t1,
      },
    })
    expect(isNewerNotificationMarker(baseline, snap2)).toBe(true)
    baseline = advanceNotificationMarker(baseline, snap2)

    // 用户将点赞组标为已读：latest 回退到更早的未读通知 id=9 (t0)，seq=3 -> 绝不能误弹新通知
    const snapAfterMarkOne = toNotificationMarker({
      total: 1,
      latestId: 21,
      latestAt: t1,
      seq: 3,
      latest: {
        id: 9,
        type: 'comment.created',
        aggregateCount: 1,
        targetType: TargetType.Post,
        targetId: 3,
        isRead: false,
        activityAt: t0,
      },
    })
    expect(isNewerNotificationMarker(baseline, snapAfterMarkOne)).toBe(false)
    baseline = advanceNotificationMarker(baseline, snapAfterMarkOne)

    // 全部标为已读：total=0, latest=null -> 绝不误弹
    const snapAllRead = toNotificationMarker({
      total: 0,
      latestId: 21,
      latestAt: t1,
      seq: 4,
      latest: null,
    })
    expect(isNewerNotificationMarker(baseline, snapAllRead)).toBe(false)
  })
})
