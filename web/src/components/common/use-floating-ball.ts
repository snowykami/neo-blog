'use client'

import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStoredState } from '@/hooks/use-storage-state'

// 悬浮球位置：可拖动，松手后吸附到左右边缘，位置记忆在浏览器；任何时候都保持在安全区内

const STORAGE_KEY = 'music-ball-position'
const EDGE_GAP = 12 // 与视口左、右、下边缘的距离
const TOP_GAP = 72 // 顶部避开导航栏
const DRAG_THRESHOLD = 5 // 移动超过多少像素才算拖动，否则视为点击
const DESKTOP_QUERY = '(min-width: 1024px)'

// side：吸附在哪一侧；y：在垂直可活动范围内的比例（0 为最上，1 为最下），屏幕尺寸变化后仍落在相近的位置
interface StoredPosition {
  side: 'left' | 'right'
  y: number
}

const DEFAULT_POSITION: StoredPosition = { side: 'right', y: 1 }

interface Viewport {
  width: number
  height: number
  size: number // 悬浮球尺寸，与 h-12 / lg:h-16 一致
  insets: { top: number, right: number, bottom: number, left: number }
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 读取刘海、底部横条等系统安全区（env(safe-area-inset-*) 只能通过元素的计算样式取得） */
function readSafeInsets(): Viewport['insets'] {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  }
  probe.remove()
  return insets
}

function getBounds({ width, height, size, insets }: Viewport): Bounds {
  const minX = insets.left + EDGE_GAP
  const minY = insets.top + TOP_GAP
  return {
    minX,
    maxX: Math.max(minX, width - insets.right - EDGE_GAP - size),
    minY,
    // 视口过矮时上下边界重合，悬浮球停在最低可用位置
    maxY: Math.max(minY, height - insets.bottom - EDGE_GAP - size),
  }
}

export function useFloatingBall({ onDragStart }: { onDragStart?: () => void } = {}) {
  const [stored, setStored, loaded] = useStoredState<StoredPosition>(STORAGE_KEY, DEFAULT_POSITION)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  // 拖动中的实时位置；为 null 时按记忆的位置停靠
  const [dragPosition, setDragPosition] = useState<{ x: number, y: number } | null>(null)
  const dragRef = useRef<{ pointerId: number, startX: number, startY: number, originX: number, originY: number, moved: boolean } | null>(null)
  // 拖动结束时浏览器仍会触发 click，用于阻止其打开播放器
  const suppressClickRef = useRef(false)

  // 视口变化（窗口缩放、旋转屏幕、移动端工具栏收起）时重新计算，保证悬浮球回到安全区内
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const measure = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
      size: desktop.matches ? 64 : 48,
      insets: readSafeInsets(),
    })
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    desktop.addEventListener('change', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      desktop.removeEventListener('change', measure)
    }
  }, [])

  const bounds = viewport ? getBounds(viewport) : null
  // 记忆的位置可能来自旧版本或被手动修改，读取时同样限制在合法范围内
  const side = stored?.side === 'left' ? 'left' : 'right'
  const ratio = clamp(Number(stored?.y) || 0, 0, 1)
  const restingPosition = bounds
    ? { x: side === 'left' ? bounds.minX : bounds.maxX, y: bounds.minY + ratio * (bounds.maxY - bounds.minY) }
    : null
  const position = dragPosition ?? restingPosition

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !position)
      return
    // 按下即捕获指针：快速甩动时第一个移动事件可能已离开悬浮球，捕获后仍由悬浮球接收；不影响随后的点击
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y, moved: false }
  }, [position])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !bounds)
      return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD)
        return
      drag.moved = true
      onDragStart?.()
    }
    setDragPosition({
      x: clamp(drag.originX + dx, bounds.minX, bounds.maxX),
      y: clamp(drag.originY + dy, bounds.minY, bounds.maxY),
    })
  }, [bounds, onDragStart])

  const finishDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId)
      return
    dragRef.current = null
    if (!drag.moved || !bounds || !viewport || !dragPosition)
      return
    suppressClickRef.current = true
    // 吸附到较近的一侧，垂直位置按可活动范围的比例记忆
    const center = dragPosition.x + viewport.size / 2
    const range = bounds.maxY - bounds.minY
    setStored({
      side: center < viewport.width / 2 ? 'left' : 'right',
      y: range > 0 ? clamp((dragPosition.y - bounds.minY) / range, 0, 1) : 1,
    })
    setDragPosition(null)
  }, [bounds, viewport, dragPosition, setStored])

  // 拖动后紧跟的 click 不打开播放器（Radix 的触发器会跳过已 preventDefault 的点击）
  const onClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
    }
  }, [])

  return {
    // 尚未读取记忆位置或视口时先隐藏，避免从默认位置跳到记忆位置
    ready: loaded && position != null,
    dragging: dragPosition != null,
    style: position ? { left: position.x, top: position.y } : undefined,
    // 弹层朝屏幕中较宽敞的方向展开
    side,
    upperHalf: position != null && viewport != null && position.y + viewport.size / 2 < viewport.height / 2,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag, onClick },
  }
}
