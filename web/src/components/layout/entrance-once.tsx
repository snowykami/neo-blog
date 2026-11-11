'use client'

import { useEffect } from 'react'

/**
 * 入场动画（styles/animation.css 的 enter-fade-*）的完整版（延迟 150ms + 300ms）只在首屏（整页加载）播放：
 * 水合后等首屏正在播的入场动画播完，再给根节点加 data-entered，之后客户端跳转新挂上的页面外壳（SiteShell）播放轻快版。
 * 不在水合时立即加：慢网下水合时首屏动画可能还没播完，中途改时长与延迟会让动画进度跳变
 */
export function EntranceOnce() {
  useEffect(() => {
    const running = document.getAnimations().filter(
      animation => animation instanceof CSSAnimation && animation.animationName.startsWith('enter-fade'),
    )
    let cancelled = false
    // 元素被移除时动画取消、finished 会 reject，一并当作播完
    Promise.allSettled(running.map(animation => animation.finished)).then(() => {
      if (!cancelled)
        document.documentElement.setAttribute('data-entered', '')
    })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
