'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface ScrollAffordanceState {
  isOverflowing: boolean
  canScrollUp: boolean
  canScrollDown: boolean
  hasSubstantialBelow: boolean
}

const EDGE_THRESHOLD_PX = 6
const PILL_REMAINING_THRESHOLD_PX = 36
const MIN_THUMB_HEIGHT_PX = 24

/**
 * 通用可滚动区域视觉感知容器（Scroll Affordance）：
 * 1. 上下渐隐遮罩（Scrim）：底部溢出时柔和截断半露条目（Peek + Fade），下滑后顶部浮现回滚提示；
 * 2. 自绘极细滑轨（2.5px）：解决 iOS / Android 静置隐藏系统滚动条导致用户不知可滚的问题，滑块位移通过 ref 直接写 transform（滚动过程零 React 重渲染）；
 * 3. 底部可点按「向下滚动」微胶囊：仅在静止于顶部（!canScrollUp）且下方溢出距离充足时浮现，用户一旦开始滚动即退场让出全部点击热区。
 */
export function ScrollAffordance({
  children,
  viewportRef: externalViewportRef,
  surface = 'card',
  moreHintLabel,
  showHintPill = true,
  overscrollContain = false,
  onStateChange,
  className,
  viewportClassName,
}: {
  children: React.ReactNode
  viewportRef?: React.RefObject<HTMLDivElement | null>
  surface?: 'background' | 'card'
  moreHintLabel?: string
  showHintPill?: boolean
  overscrollContain?: boolean
  onStateChange?: (state: ScrollAffordanceState) => void
  className?: string
  viewportClassName?: string
}) {
  const internalViewportRef = useRef<HTMLDivElement | null>(null)
  const innerContentRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const pillBtnRef = useRef<HTMLButtonElement | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const [state, setState] = useState<ScrollAffordanceState>({
    isOverflowing: false,
    canScrollUp: false,
    canScrollDown: false,
    hasSubstantialBelow: false,
  })

  const setViewportNode = useCallback((node: HTMLDivElement | null) => {
    internalViewportRef.current = node
    if (externalViewportRef)
      externalViewportRef.current = node
  }, [externalViewportRef])

  const syncMetrics = useCallback(() => {
    const el = internalViewportRef.current
    if (!el)
      return

    // 先集中读取布局几何属性，再写入滑块样式，杜绝读写交错引发强制同步回流
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    const remainingBelow = maxScroll - scrollTop
    const isOverflowing = maxScroll > EDGE_THRESHOLD_PX
    const canScrollUp = isOverflowing && scrollTop > EDGE_THRESHOLD_PX
    const canScrollDown = isOverflowing && remainingBelow > EDGE_THRESHOLD_PX
    const hasSubstantialBelow = isOverflowing && remainingBelow > PILL_REMAINING_THRESHOLD_PX
    const trackHeight = trackRef.current?.clientHeight ?? 0

    if (isOverflowing && thumbRef.current && trackHeight > 0) {
      const ratio = clientHeight / scrollHeight
      const thumbHeight = Math.min(trackHeight, Math.max(MIN_THUMB_HEIGHT_PX, Math.round(trackHeight * ratio)))
      const maxThumbOffset = Math.max(0, trackHeight - thumbHeight)
      const progress = Math.min(1, Math.max(0, scrollTop / maxScroll))
      const thumbY = Math.round(progress * maxThumbOffset)
      thumbRef.current.style.height = `${thumbHeight}px`
      thumbRef.current.style.transform = `translate3d(0, ${thumbY}px, 0)`
    }

    setState((prev) => {
      if (
        prev.isOverflowing === isOverflowing
        && prev.canScrollUp === canScrollUp
        && prev.canScrollDown === canScrollDown
        && prev.hasSubstantialBelow === hasSubstantialBelow
      ) {
        return prev
      }
      return { isOverflowing, canScrollUp, canScrollDown, hasSubstantialBelow }
    })
  }, [])

  useEffect(() => {
    onStateChangeRef.current?.(state)
  }, [state])

  useEffect(() => {
    syncMetrics()
    if (typeof ResizeObserver === 'undefined')
      return
    const viewportEl = internalViewportRef.current
    const contentEl = innerContentRef.current
    if (!viewportEl)
      return

    const ro = new ResizeObserver(() => {
      syncMetrics()
    })
    ro.observe(viewportEl)
    if (contentEl)
      ro.observe(contentEl)
    return () => {
      ro.disconnect()
    }
  }, [syncMetrics])

  // 微胶囊仅在静止顶部（!canScrollUp）且下方溢出充裕时浮现；隐藏前先释放按钮焦点，避免 aria-hidden 命中当前 activeElement 触发 WAI-ARIA 警告
  const showPill = Boolean(showHintPill && moreHintLabel && !state.canScrollUp && state.hasSubstantialBelow)

  useLayoutEffect(() => {
    if (!showPill && typeof document !== 'undefined' && pillBtnRef.current && document.activeElement === pillBtnRef.current) {
      pillBtnRef.current.blur()
    }
  }, [showPill])

  const handleScrollDownStep = useCallback(() => {
    const el = internalViewportRef.current
    if (!el)
      return
    pillBtnRef.current?.blur()
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const step = Math.max(120, Math.round(el.clientHeight * 0.72))
    if (typeof el.scrollBy === 'function') {
      el.scrollBy({ top: step, behavior: reduceMotion ? 'auto' : 'smooth' })
    }
    else {
      el.scrollTop += step
      syncMetrics()
    }
  }, [syncMetrics])

  const topGradientClass = surface === 'background'
    ? 'from-background via-background/80 to-transparent'
    : 'from-card via-card/80 to-transparent'
  const bottomGradientClass = surface === 'background'
    ? 'from-background via-background/85 to-transparent'
    : 'from-card via-card/85 to-transparent'

  return (
    <div className={cn('relative', className)}>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b transition-opacity duration-150',
          topGradientClass,
          state.canScrollUp ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={setViewportNode}
        onScroll={syncMetrics}
        className={cn(
          'overflow-x-hidden overflow-y-auto hide-scrollbar',
          overscrollContain && 'overscroll-contain',
          viewportClassName,
        )}
      >
        <div ref={innerContentRef} className="min-w-0">
          {children}
        </div>
      </div>

      {/* 静置可见的 2.5px 自绘滚动进度条：仅在内容溢出时显现 */}
      <div
        ref={trackRef}
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-2 right-0.5 bottom-2 z-20 w-[2.5px] rounded-full bg-foreground/[0.07] transition-opacity duration-200',
          state.isOverflowing ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          ref={thumbRef}
          className="w-full rounded-full bg-primary/45 will-change-transform"
          style={{ height: `${MIN_THUMB_HEIGHT_PX}px`, transform: 'translate3d(0, 0px, 0)' }}
        />
      </div>

      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-7 bg-gradient-to-t transition-opacity duration-150',
          bottomGradientClass,
          state.canScrollDown ? 'opacity-100' : 'opacity-0',
        )}
      />

      {showHintPill && moreHintLabel && (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-1.5 z-20 flex justify-center transition-[opacity,transform] duration-150 motion-reduce:transition-none',
            showPill ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          <button
            ref={pillBtnRef}
            type="button"
            tabIndex={showPill ? 0 : -1}
            aria-hidden={!showPill}
            onClick={handleScrollDownStep}
            className={cn(
              'inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-border/75 bg-card px-2.5 text-[11px] font-medium text-muted-foreground shadow-xs transition-[color,transform] duration-150 hover:text-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showPill ? 'pointer-events-auto' : 'pointer-events-none',
            )}
          >
            <span>{moreHintLabel}</span>
            <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
          </button>
        </div>
      )}
    </div>
  )
}
