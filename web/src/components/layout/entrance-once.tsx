'use client'

import { useEffect } from 'react'

/**
 * 入场动画（styles/animation.css 的 enter-fade-*）只在首屏（整页加载）播放一次：
 * 水合后等首屏正在播的入场动画播完，再给根节点加 data-entered，之后客户端跳转新挂上的页面外壳（SiteShell）不再重播。
 * 不在水合时立即加：慢网下水合时首屏动画（延迟 150ms + 300ms）可能还没播完，中途去掉动画会让内容直接跳到终点
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
