'use client'

import type { EditEvent, EditSessionTarget } from '@/models/edit-session'
import { useEffect, useRef } from 'react'
import { streamEditEvents } from '@/api/edit-session'

const RECONNECT_MAX_MS = 30_000

/**
 * 订阅文章 / 页面的编辑事件（SSE），连接结束或出错后自动重连（指数退避，最长 30 秒）
 * - 每次连上都会先收到 ready：断开期间可能错过了事件，调用方应按需重新拉取
 * - 无权限、内容不存在等 4xx 错误不再重连
 * - id 为 0 时视为尚未就绪，不订阅
 */
export function useEditEvents(target: EditSessionTarget, id: number, onEvent: (event: EditEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!id)
      return
    const controller = new AbortController()
    let timer: number | undefined
    let attempt = 0
    const connect = async () => {
      try {
        await streamEditEvents({
          target,
          id,
          signal: controller.signal,
          onEvent: (event) => {
            // 连上后重置退避
            attempt = 0
            onEventRef.current(event)
          },
        })
      }
      catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status
        if (controller.signal.aborted || (status && status >= 400 && status < 500))
          return
      }
      if (controller.signal.aborted)
        return
      timer = window.setTimeout(connect, Math.min(RECONNECT_MAX_MS, 1000 * 2 ** attempt))
      attempt++
    }
    void connect()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [target, id])
}
