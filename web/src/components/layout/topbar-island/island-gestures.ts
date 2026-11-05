'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * 灵动岛的手势（参考 Apple 灵动岛：横向滑过切换活动、滑动隐藏、长按展开、展开后上滑收起）。
 * 触屏、触控笔与鼠标共用指针事件；触控板的双指横扫走 wheel 事件。竖向的拖动不接管，交给页面滚动（容器需设 touch-action: pan-y）。
 * 滑动只让内容跟手平移（CSS translate），胶囊本身的尺寸不变
 */

/** 手指滑动的方向：-1 向左，1 向右 */
export type SwipeDirection = -1 | 1

// 判定为拖动前允许的抖动
const SLOP_PX = 8
// 松手时滑过这么远，或按这个速度甩出（px/ms），算作一次滑动
const SWIPE_DISTANCE_PX = 40
const SWIPE_VELOCITY = 0.4
const LONG_PRESS_MS = 450
// 内容跟手的比例与上限：越拉越沉，不会被拖出胶囊
const FOLLOW_RATIO = 0.5
const FOLLOW_MAX_PX = 48
// 触控板横扫：累计这么远触发一次，停下这么久后才能再次触发（惯性滚动的尾巴不会连续触发）
const WHEEL_DISTANCE = 48
const WHEEL_IDLE_MS = 220
const SNAP_BACK = 'translate 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2)'
// 上滑收起面板：竖向滑过这么远，且明显比横向多
const PANEL_CLOSE_DISTANCE_PX = 56

interface Gesture {
  id: number
  x0: number
  y0: number
  lastX: number
  lastT: number
  velocity: number
  horizontal: boolean
}

export interface IslandGestureOptions {
  // 横向滑动；返回 false 表示没有对应的操作（内容弹回原位）
  onSwipe?: (direction: SwipeDirection) => boolean
  onLongPress?: () => void
  // 拖动时跟手平移的元素
  follow?: () => HTMLElement | null
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function snapBack(el: HTMLElement | null | undefined) {
  if (!el || !el.style.translate)
    return
  el.style.transition = reducedMotion() ? 'none' : SNAP_BACK
  el.style.translate = ''
}

/**
 * 胶囊与站名上的手势：返回要展开到元素上的事件处理与 ref（ref 用于挂原生的 wheel 监听，需要阻止默认行为）。
 * 拖动或长按之后紧跟着的 click 会被吞掉，不会再触发点按
 */
export function useIslandGestures(options: IslandGestureOptions) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const gestureRef = useRef<Gesture | null>(null)
  const timerRef = useRef(0)
  const suppressClickRef = useRef(false)
  const lastPointerRef = useRef('')
  const wheelRef = useRef({ acc: 0, last: -Infinity, fired: false })

  const clearTimer = () => {
    window.clearTimeout(timerRef.current)
    timerRef.current = 0
  }
  useEffect(() => clearTimer, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    lastPointerRef.current = event.pointerType
    if (event.pointerType === 'mouse' && event.button !== 0)
      return
    gestureRef.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, lastX: event.clientX, lastT: event.timeStamp, velocity: 0, horizontal: false }
    suppressClickRef.current = false
    clearTimer()
    if (optionsRef.current.onLongPress) {
      timerRef.current = window.setTimeout(() => {
        if (!gestureRef.current || gestureRef.current.horizontal)
          return
        gestureRef.current = null
        suppressClickRef.current = true
        optionsRef.current.onLongPress?.()
      }, LONG_PRESS_MS)
    }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.id)
      return
    const dx = event.clientX - gesture.x0
    const dy = event.clientY - gesture.y0
    if (!gesture.horizontal) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX)
        return
      clearTimer()
      // 竖向为主（或没有横向操作）时放手，交给页面滚动
      if (!optionsRef.current.onSwipe || Math.abs(dx) <= Math.abs(dy)) {
        gestureRef.current = null
        return
      }
      gesture.horizontal = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      catch {}
    }
    const dt = event.timeStamp - gesture.lastT
    if (dt > 0)
      gesture.velocity = 0.8 * ((event.clientX - gesture.lastX) / dt) + 0.2 * gesture.velocity
    gesture.lastX = event.clientX
    gesture.lastT = event.timeStamp
    const el = optionsRef.current.follow?.()
    if (el) {
      el.style.transition = 'none'
      el.style.translate = `${(Math.sign(dx) * Math.min(Math.abs(dx) * FOLLOW_RATIO, FOLLOW_MAX_PX)).toFixed(1)}px 0`
    }
  }, [])

  const finish = useCallback((event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    clearTimer()
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture || event.pointerId !== gesture.id || !gesture.horizontal)
      return
    suppressClickRef.current = true
    const el = optionsRef.current.follow?.()
    const dx = event.clientX - gesture.x0
    const flung = Math.abs(gesture.velocity) >= SWIPE_VELOCITY && Math.sign(gesture.velocity) === Math.sign(dx)
    const handled = !cancelled && (Math.abs(dx) >= SWIPE_DISTANCE_PX || flung) && (optionsRef.current.onSwipe?.(dx < 0 ? -1 : 1) ?? false)
    // 换了内容时旧内容带着位移淡出；没有换（或仍是同一个元素）时弹回原位
    if (handled)
      window.setTimeout(snapBack, 400, el)
    else
      snapBack(el)
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => finish(event, false), [finish])
  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => finish(event, true), [finish])

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current)
      return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // 触屏长按时不弹出系统菜单（桌面端右键保留）
  const onContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (lastPointerRef.current === 'touch' || lastPointerRef.current === 'pen')
      event.preventDefault()
  }, [])

  // 触控板双指横扫：横向为主时阻止默认行为（不然会触发浏览器的前进 / 后退）；React 的 wheel 监听是被动的，这里挂原生监听
  const wheelCleanupRef = useRef<(() => void) | null>(null)
  const ref = useCallback((node: HTMLElement | null) => {
    wheelCleanupRef.current?.()
    wheelCleanupRef.current = null
    if (!node)
      return
    const onWheel = (event: WheelEvent) => {
      if (!optionsRef.current.onSwipe || Math.abs(event.deltaX) <= Math.abs(event.deltaY))
        return
      event.preventDefault()
      const wheel = wheelRef.current
      if (event.timeStamp - wheel.last > WHEEL_IDLE_MS) {
        wheel.acc = 0
        wheel.fired = false
      }
      wheel.last = event.timeStamp
      if (wheel.fired)
        return
      wheel.acc += event.deltaX
      if (Math.abs(wheel.acc) >= WHEEL_DISTANCE) {
        wheel.fired = true
        // deltaX 为正：内容向右滚，即手指向左扫
        optionsRef.current.onSwipe(wheel.acc > 0 ? -1 : 1)
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    wheelCleanupRef.current = () => node.removeEventListener('wheel', onWheel)
  }, [])

  return {
    ref,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture, onContextMenu },
  }
}

// 面板里这些区域自己处理拖动（歌词滚动、进度条、输入框），不当作收起手势
const PANEL_OWN_DRAG = '.lyric-player, [role="slider"], input, textarea, select, [data-island-no-swipe]'

function scrollsVertically(target: Element, root: Element) {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))
      return true
  }
  return false
}

/** 展开的面板上滑收起（只认触屏与触控笔；从歌词、进度条、可滚动区域开始的拖动不算） */
export function usePanelSwipeUp(onClose: () => void) {
  const startRef = useRef<{ id: number, x: number, y: number } | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      const target = event.target as Element
      startRef.current = event.pointerType !== 'mouse' && !target.closest(PANEL_OWN_DRAG) && !scrollsVertically(target, event.currentTarget)
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current
      startRef.current = null
      if (!start || start.id !== event.pointerId)
        return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (-dy >= PANEL_CLOSE_DISTANCE_PX && -dy > Math.abs(dx) * 1.5)
        onCloseRef.current()
    },
    onPointerCancel: () => {
      startRef.current = null
    },
  }
}
