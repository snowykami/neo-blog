'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 存在未保存修改时，关闭/刷新标签页前弹出浏览器确认提示
 * @param hasUnsavedChanges 返回当前是否有未保存修改
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: () => boolean) {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges())
        return
      event.preventDefault()
      // 兼容旧版浏览器
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])
}

/**
 * 全屏状态与切换；监听 fullscreenchange，按 Esc 退出时也能同步状态
 */
export function useFullscreen(onError?: (error: Error) => void) {
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    const sync = () => setIsFullScreen(Boolean(document.fullscreenElement))
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggleFullScreen = useCallback(() => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    action.catch((error: Error) => onError?.(error))
  }, [onError])

  return { isFullScreen, toggleFullScreen }
}
