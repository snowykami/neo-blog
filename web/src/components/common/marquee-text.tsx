'use client'

import type { ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// 每一圈开始时停顿的时长：先让读者看到完整的开头再滚动
const MARQUEE_HOLD_MS = 2000
// 两份文字之间的间距（px）
const MARQUEE_GAP_PX = 40
// 渐隐宽度
const FADE = '0.75rem'
// 停顿时只渐隐右端（开头完整可见），滚动时两端渐隐
const MASK_END = `linear-gradient(to right, black, black calc(100% - ${FADE}), transparent)`
const MASK_BOTH = `linear-gradient(to right, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)`

const maskFrame = (mask: string, offset: number): Keyframe => ({ offset, maskImage: mask, webkitMaskImage: mask })

/**
 * 单行文字：超出容器宽度时以跑马灯滚动，否则正常显示；减少动态效果时改为省略号截断。
 * 每一圈开始先停顿 MARQUEE_HOLD_MS，再以 speed（px/s）匀速滚过一份文字的宽度，两份文字首尾相接，循环无缝；悬停时暂停。
 * 用隐藏的测量元素比较宽度，容器或内容尺寸变化时重新判断
 */
export function MarqueeText({ children, className, speed = 30 }: { children: ReactNode, className?: string, speed?: number }) {
  const reducedMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const animationsRef = useRef<Animation[]>([])
  // 溢出时为一份文字的宽度，否则为 0
  const [contentWidth, setContentWidth] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure)
      return
    const update = () => {
      const width = measure.offsetWidth
      setContentWidth(width > container.clientWidth + 1 ? width : 0)
    }
    update()
    if (typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [])

  const scrolling = contentWidth > 0 && !reducedMotion

  useEffect(() => {
    const container = containerRef.current
    const track = trackRef.current
    if (!scrolling || !container || !track || typeof track.animate !== 'function')
      return
    const distance = contentWidth + MARQUEE_GAP_PX
    const duration = MARQUEE_HOLD_MS + (distance / speed) * 1000
    const hold = MARQUEE_HOLD_MS / duration
    const timing: KeyframeAnimationOptions = { duration, iterations: Infinity, easing: 'linear' }
    animationsRef.current = [
      track.animate([
        { offset: 0, transform: 'translateX(0)' },
        { offset: hold, transform: 'translateX(0)' },
        { offset: 1, transform: `translateX(${-distance}px)` },
      ], timing),
      // 遮罩随滚动切换：停顿时开头不渐隐，开始滚动后两端渐隐；一圈结束时第二份文字回到开头，切回只渐隐右端
      container.animate([
        maskFrame(MASK_END, 0),
        maskFrame(MASK_END, hold),
        maskFrame(MASK_BOTH, hold),
        maskFrame(MASK_BOTH, 1),
      ], timing),
    ]
    return () => {
      animationsRef.current.forEach(animation => animation.cancel())
      animationsRef.current = []
    }
  }, [contentWidth, scrolling, speed])

  return (
    <div
      ref={containerRef}
      className={cn('relative min-w-0 overflow-hidden whitespace-nowrap', className)}
      onPointerEnter={() => animationsRef.current.forEach(animation => animation.pause())}
      onPointerLeave={() => animationsRef.current.forEach(animation => animation.play())}
    >
      <span ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap">{children}</span>
      {scrolling
        ? (
            <>
              <span className="sr-only">{children}</span>
              <span ref={trackRef} aria-hidden className="inline-flex will-change-transform" style={{ gap: MARQUEE_GAP_PX }}>
                <span>{children}</span>
                <span>{children}</span>
              </span>
            </>
          )
        : <span className="block truncate">{children}</span>}
    </div>
  )
}
