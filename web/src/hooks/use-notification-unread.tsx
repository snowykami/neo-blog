'use client'

import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getUnreadNotificationCount } from '@/api/notification'
import { useAuth } from '@/contexts/auth-context'
import { pushIslandAlert } from '@/contexts/topbar-island'
import { apiUrl, PUBLIC_BACKEND_URL } from '@/utils/common/api-url'

// 兜底轮询间隔：SSE 连不上时（代理不支持长连接等）仍能更新徽标
const POLL_INTERVAL_MS = 60_000

/**
 * 顶栏的未读通知数：优先用 SSE（/notifications/stream）实时更新，断线时退回 60 秒轮询。
 * 未读单位是聚合组（点赞组也算一个），所以这里直接用后端算好的数
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth()
  const t = useTranslations('Notifications')
  const [count, setCount] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const previous = useRef(0)

  const apply = useCallback((total: number) => {
    setCount(total)
    // 数字变大说明来了新通知：在灵动岛上提一句（后台页没有顶栏时不显示，交给 toast）
    if (total > previous.current && previous.current >= 0 && user) {
      // 消息类提示（layer: notice）：不插队、会被点赞/评论等反馈盖掉，被盖掉后回到队首重新计时
      // TODO(通知内容化)：后端 SSE 目前只推未读组数，「有新通知」既不知道是什么也不能点；
      // 改成推事件明细后这里换成「小明等 3 人赞了《x》」并补上 onPress（跳 /notifications）。
      // 另外点赞按 类型:目标:自然日 聚合成一个未读组（internal/repo/notification.go 的分组表达式），
      // 组数不涨的时候这里不会提示，这也是「点赞不上岛」的主要原因，一并解决
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
    }
    previous.current = total
  }, [t, user])

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0)
      previous.current = 0
      return
    }
    try {
      const res = await getUnreadNotificationCount()
      setCount(res.data.total)
      previous.current = res.data.total
    }
    catch {
      // 拉取失败保持上一次的数字，不打断用户
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setCount(0)
      previous.current = 0
      return
    }
    void refresh()
    timer.current = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    // SSE：浏览器会自动重连，这里只需要把收到的未读数写进状态
    let source: EventSource | null = null
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(apiUrl('/api/v1/notifications/stream'), {
        // 直连后端时是跨源 SSE，必须显式带上 cookie
        withCredentials: Boolean(PUBLIC_BACKEND_URL),
      })
      source.addEventListener('unread', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { total?: number }
          if (typeof payload.total === 'number')
            apply(payload.total)
        }
        catch {
          // 解析失败就等下一次推送
        }
      })
      source.onerror = () => {
        // 断线后由 EventSource 自己重连，轮询作为兜底继续跑
      }
    }

    return () => {
      if (timer.current)
        clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [apply, refresh, user])

  return { count, refresh }
}
