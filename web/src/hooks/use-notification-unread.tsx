'use client'

import type { NotificationMarker } from './notification-unread-marker'
import type { NotificationUnreadCount } from '@/models/notification'
import { snakeToCamelObj } from 'field-conv'
import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getUnreadNotificationCount } from '@/api/notification'
import { useAuth } from '@/contexts/auth-context'
import { pushIslandAlert } from '@/contexts/topbar-island'
import { isNewerNotificationMarker, toNotificationMarker } from './notification-unread-marker'

// 兜底轮询间隔：只在 SSE 断开或连不上（代理不支持长连接、连接数超限）时启用
const POLL_INTERVAL_MS = 60_000

/**
 * 顶栏的未读通知数：优先用 SSE（/notifications/stream）实时更新，SSE 断开期间才退回 60 秒轮询。
 * 未读单位是聚合组（点赞组也算一个），所以这里直接用后端算好的数；
 * 「来了新通知」看最近一条通知的标记有没有变新（见 notification-unread-marker.ts），不看组数
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth()
  const t = useTranslations('Notifications')
  const [count, setCount] = useState(0)
  // undefined = 还没有基线：第一次拿到的值只记下来不提示
  const latest = useRef<NotificationMarker | null | undefined>(undefined)

  const apply = useCallback((payload: NotificationUnreadCount) => {
    setCount(payload.total)
    const next = toNotificationMarker(payload)
    const isNew = isNewerNotificationMarker(latest.current, next)
    // 只往前走：旧请求晚到、取消点赞让最新一条变旧时不回退基线，避免之后重复提示
    if (latest.current === undefined || isNew)
      latest.current = next
    if (!isNew || !user)
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
  }, [t, user])

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0)
      latest.current = undefined
      return
    }
    try {
      const res = await getUnreadNotificationCount()
      apply(res.data)
    }
    catch {
      // 拉取失败保持上一次的数字，不打断用户
    }
  }, [apply, user])

  useEffect(() => {
    if (!user) {
      setCount(0)
      latest.current = undefined
      return
    }
    void refresh()
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

    // SSE：连上后由推送更新；断开时浏览器会自动重连，期间用轮询兜底，重新连上就停掉轮询
    let source: EventSource | null = null
    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/v1/notifications/stream')
      source.addEventListener('unread', (event) => {
        try {
          // SSE 不经过 axios 的字段转换：后端是 snake_case（latest_id / latest_at），这里自己转一次
          const payload = snakeToCamelObj(JSON.parse((event as MessageEvent<string>).data)) as Partial<NotificationUnreadCount>
          if (typeof payload.total === 'number') {
            apply({
              total: payload.total,
              byType: payload.byType ?? {},
              latestId: payload.latestId ?? 0,
              latestAt: payload.latestAt ?? null,
            })
          }
        }
        catch {
          // 解析失败就等下一次推送
        }
      })
      source.onopen = () => stopPolling()
      source.onerror = () => {
        // 断线（CONNECTING：浏览器在重连）或被拒绝（CLOSED：如连接数超限返回 429，不会再重连）都先轮询兜底
        startPolling()
      }
    }
    else {
      startPolling()
    }

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [apply, refresh, user])

  return { count, refresh }
}
