'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUnreadNotificationCount } from '@/api/notification'
import { useAuth } from '@/contexts/auth-context'

// 未读徽标的刷新间隔：通知量大时也不值得更频繁
const POLL_INTERVAL_MS = 60_000

/**
 * 顶栏的未读通知数：登录后每 60 秒拉一次，页面重新可见时立刻刷新。
 * 未读单位是聚合组（点赞组也算一个），所以这里直接用后端算好的数
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0)
      return
    }
    try {
      const res = await getUnreadNotificationCount()
      setCount(res.data.total)
    }
    catch {
      // 拉取失败保持上一次的数字，不打断用户
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }
    void refresh()
    timer.current = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current)
        clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, user])

  return { count, refresh }
}
