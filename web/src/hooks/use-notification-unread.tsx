'use client'

import type { NotificationMarker } from './notification-unread-marker'
import type { NotificationUnreadCount } from '@/models/notification'
import { snakeToCamelObj } from 'field-conv'
import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { getUnreadNotificationCount } from '@/api/notification'
import { useAuth } from '@/contexts/auth-context'
import { pushIslandAlert } from '@/contexts/topbar-island'
import { isNewerNotificationMarker, toNotificationMarker } from './notification-unread-marker'
import {
  getUnreadSnapshot,
  nextSseRetryDelay,
  registerUnreadRefresher,
  setUnreadSnapshot,
  subscribeUnreadSnapshot,
} from './notification-unread-store'

// 兜底轮询间隔：只在 SSE 断开或连不上（代理不支持长连接、连接数超限）时启用
const POLL_INTERVAL_MS = 60_000

/** 当前账号的未读状态（见 notification-unread-store.ts）；还没取到或属于别的账号时为 null */
export function useUnreadNotificationSnapshot(): NotificationUnreadCount | null {
  const { user } = useAuth()
  const current = useSyncExternalStore(subscribeUnreadSnapshot, getUnreadSnapshot, () => null)
  return current && user && current.userId === user.id ? current.payload : null
}

/**
 * 顶栏的未读通知数：优先用 SSE（/notifications/stream）实时更新，SSE 断开期间才退回 60 秒轮询。
 * 未读单位是聚合组（点赞组也算一个），所以这里直接用后端算好的数；
 * 「来了新通知」看最近一条通知的标记有没有变新（见 notification-unread-marker.ts），不看组数。
 * 只应在一个地方使用（顶栏头像）：每次使用都会建一条实时连接；其他地方读 useUnreadNotificationSnapshot
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth()
  // 只跟随账号变化：用户对象在改配色、改资料时也会换新，不能因此重连
  const userId = user?.id ?? null
  const t = useTranslations('Notifications')
  const payload = useUnreadNotificationSnapshot()
  // undefined = 还没有基线：第一次拿到的值只记下来不提示
  const latest = useRef<NotificationMarker | null | undefined>(undefined)
  // 当前账号：请求发出后账号已切换（登出、换号）时丢弃晚到的结果，不把上一个账号的数字记到新账号上
  const activeUser = useRef<number | null>(userId)

  const apply = useCallback((forUser: number, next: NotificationUnreadCount) => {
    if (activeUser.current !== forUser)
      return
    setUnreadSnapshot({ userId: forUser, payload: next })
    const marker = toNotificationMarker(next)
    const isNew = isNewerNotificationMarker(latest.current, marker)
    // 只往前走：旧请求晚到、取消点赞让最新一条变旧时不回退基线，避免之后重复提示
    if (latest.current === undefined || isNew)
      latest.current = marker
    if (!isNew)
      return
    // 在灵动岛上提一句（后台页没有顶栏时不显示，交给 toast）
    // 消息类提示（layer: notice）：不插队、会被点赞/评论等反馈盖掉，被盖掉后回到队首重新计时
    // TODO(通知内容化)：SSE 目前只推未读组数与最近一条的标记，提示还不知道是什么也不能点；
    // 改成推事件明细后这里换成「小明等 3 人赞了《x》」并补上 onPress（跳 /notifications）
    const shown = pushIslandAlert({
      key: 'notification',
      feature: 'feedback',
      layer: 'notice',
      resume: 'restart',
      icon: <BellRing aria-hidden className="text-sky-400" />,
      text: t('new_notification'),
    })
    if (!shown)
      toast.info(t('new_notification'))
  }, [t])

  const refresh = useCallback(async () => {
    const forUser = activeUser.current
    if (forUser === null)
      return
    try {
      const res = await getUnreadNotificationCount()
      apply(forUser, res.data)
    }
    catch {
      // 拉取失败保持上一次的数字，不打断用户
    }
  }, [apply])

  useEffect(() => {
    // 换账号（登出、或从 A 直接切到 B）时清空基线与快照：新账号第一次拿到的值只当基线，不会被当成「来了新通知」
    activeUser.current = userId
    latest.current = undefined
    if (getUnreadSnapshot()?.userId !== userId)
      setUnreadSnapshot(null)
    if (userId === null)
      return
    void refresh()
    const unregister = registerUnreadRefresher(() => void refresh())
    let timer: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (!timer)
        timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    }
    const stopPolling = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    // SSE：连上后由推送更新；断开时浏览器会自动重连，期间用轮询兜底，重新连上就停掉轮询。
    // 被拒绝（CLOSED）时浏览器不再重连：按退避自己重连，连上后退避清零
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = 0
    let disposed = false
    const connect = () => {
      retryTimer = null
      if (disposed)
        return
      const current = new EventSource('/api/v1/notifications/stream')
      source = current
      current.addEventListener('unread', (event) => {
        try {
          // SSE 不经过 axios 的字段转换：后端是 snake_case（latest_id / latest_at），这里自己转一次
          const data = snakeToCamelObj(JSON.parse((event as MessageEvent<string>).data)) as Partial<NotificationUnreadCount>
          if (typeof data.total === 'number') {
            apply(userId, {
              total: data.total,
              byType: data.byType ?? {},
              latestId: data.latestId ?? 0,
              latestAt: data.latestAt ?? null,
            })
          }
        }
        catch {
          // 解析失败就等下一次推送
        }
      })
      current.onopen = () => {
        retryDelay = 0
        stopPolling()
      }
      current.onerror = () => {
        // 断线（CONNECTING：浏览器在重连）或被拒绝（CLOSED）都先轮询兜底
        startPolling()
        if (current.readyState !== EventSource.CLOSED || disposed || retryTimer)
          return
        current.close()
        retryDelay = nextSseRetryDelay(retryDelay)
        retryTimer = setTimeout(connect, retryDelay)
      }
    }
    if (typeof EventSource !== 'undefined')
      connect()
    else
      startPolling()

    return () => {
      disposed = true
      stopPolling()
      unregister()
      if (retryTimer)
        clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [apply, refresh, userId])

  return { count: userId === null ? 0 : (payload?.total ?? 0), refresh }
}
