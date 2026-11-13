'use client'

import type { GestureAxis, PointerSample, Rect, Size, Transform } from './image-viewer-gesture'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ImageOffIcon,
  Loader2Icon,
  RotateCwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  applyEdgeResistance,
  clampTransform,
  classifyWheelAction,
  computeDoubleTapScale,
  computeFlipTransform,
  computePointerVelocity,
  computeVerticalDismissVisual,
  DOUBLE_TAP_DISTANCE,
  DOUBLE_TAP_MS,
  IDENTITY_TRANSFORM,
  lockGestureAxis,
  MAX_SCALE,
  MIN_SCALE,
  resolveHorizontalSwipe,
  shouldDismissOnVerticalRelease,
  SLIDE_GAP,
  SNAP_TO_IDENTITY_SCALE,
  TAP_SLOP,
  zoomTransformAtPoint,
} from './image-viewer-gesture'
import './content-image-viewer.scss'

export interface ViewerImage {
  src: string
  alt: string
  caption: string
}

interface DismissVisual {
  x: number
  y: number
  scale: number
  backdropFactor: number
}

const IDLE_DISMISS: DismissVisual = { x: 0, y: 0, scale: 1, backdropFactor: 1 }
const CLOSE_DURATION_MS = 210
const SLIDE_TRANSITION = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)'
const ZOOM_TRANSITION = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** 在页面可见区域自动查找同源 <img>（供未显式传入 getOriginElement 的调用方如评论附件缩略图计算 FLIP） */
function findVisibleOriginBySrc(src: string): HTMLElement | null {
  if (typeof document === 'undefined' || !src)
    return null
  const encoded = encodeURIComponent(src)
  const candidates = document.querySelectorAll('img')
  for (const img of candidates) {
    if (img.closest('[data-image-viewer-root]'))
      continue
    const rawAttr = img.getAttribute('src') || ''
    const matched = img.currentSrc === src
      || img.src === src
      || rawAttr === src
      || (encoded.length > 6 && (img.currentSrc.includes(encoded) || rawAttr.includes(encoded)))
    if (!matched)
      continue
    const rect = img.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight)
      return img
  }
  return null
}

function toRect(domRect: DOMRect | null | undefined): Rect | null {
  if (!domRect)
    return null
  return {
    left: domRect.left,
    top: domRect.top,
    right: domRect.right,
    bottom: domRect.bottom,
    width: domRect.width,
    height: domRect.height,
  }
}

/**
 * 图片全屏预览（受控）：index 为当前查看的序号，为 null 时关闭；正文、独立页面（经 content-image-viewer-lazy.tsx）与评论附件共用
 * - 三槽位跟手滑轨、轻扫速度切换、首尾橡皮筋阻尼、键盘与宽热区翻页
 * - 定点滚轮/双指捏合缩放、Mac 触控板双指平移长图、智能双击阅读倍率、90° 旋转与边界保护
 * - 单指下滑渐隐关闭、开合共享元素（FLIP）过渡动画、多图底部缩略图导航与移动端返回键保护
 */
export function ImageViewer({
  images,
  index,
  onIndexChange,
  getOriginElement,
}: {
  images: ViewerImage[]
  index: number | null
  onIndexChange: React.Dispatch<React.SetStateAction<number | null>>
  getOriginElement?: (index: number) => HTMLElement | null
}) {
  const t = useTranslations('ImageViewer')
  const historyToken = useId()

  // 关闭动画期间保留最后有效序号，动画结束后再真正卸载
  const [closingIndex, setClosingIndex] = useState<number | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const activeIndex = index ?? closingIndex
  const open = activeIndex !== null && images.length > 0 && Boolean(images[activeIndex])
  const current = open && activeIndex !== null ? images[activeIndex] : null

  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM)
  const [rotation, setRotation] = useState(0)
  const [swipeX, setSwipeX] = useState(0)
  const [dismissVisual, setDismissVisual] = useState<DismissVisual>(IDLE_DISMISS)
  const [dragging, setDragging] = useState(false)
  const [instantZoom, setInstantZoom] = useState(false)
  const [chromeHidden, setChromeHidden] = useState(false)
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 })
  const [loadMap, setLoadMap] = useState<Record<string, 'loaded' | 'error'>>({})

  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const activeCarrierRef = useRef<HTMLDivElement>(null)
  const currentImageRef = useRef<HTMLImageElement>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)

  const transformRef = useRef(transform)
  transformRef.current = transform
  const rotationRef = useRef(rotation)
  rotationRef.current = rotation
  const activeIndexRef = useRef(activeIndex)
  activeIndexRef.current = activeIndex
  const isClosingRef = useRef(isClosing)
  isClosingRef.current = isClosing
  const dismissVisualRef = useRef(dismissVisual)
  dismissVisualRef.current = dismissVisual

  const wasOpenRef = useRef(false)
  const prevActiveIndexRef = useRef<number | null>(null)
  const pendingSlideCarryRef = useRef<number | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trackpadUntilRef = useRef(0)

  // 移动端返回键历史记录状态
  const historyPushedRef = useRef(false)
  const historyPoppedByUserRef = useRef(false)
  const ignoreNextPopStateRef = useRef(false)

  const pointers = useRef(new Map<number, { x: number, y: number }>())
  const gesture = useRef<{
    startX: number
    startY: number
    rawDx: number
    rawDy: number
    moved: boolean
    startedOnImage: boolean
    wasMultiTouch: boolean
    capturedId: number | null
    axis: GestureAxis
    pinchDistance: number
    pinchScale: number
    samples: PointerSample[]
    lastTapTime: number
    lastTapX: number
    lastTapY: number
  }>({
    startX: 0,
    startY: 0,
    rawDx: 0,
    rawDy: 0,
    moved: false,
    startedOnImage: false,
    wasMultiTouch: false,
    capturedId: null,
    axis: null,
    pinchDistance: 0,
    pinchScale: 1,
    samples: [],
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  })

  // 外部重新指定有效 index 时，若处于关闭尾声则立即恢复打开态并重置视图
  const [trackedExternalIndex, setTrackedExternalIndex] = useState<number | null>(index)
  if (index !== trackedExternalIndex) {
    setTrackedExternalIndex(index)
    if (index !== null) {
      if (isClosing) {
        setIsClosing(false)
        setClosingIndex(null)
      }
      setTransform(IDENTITY_TRANSFORM)
      setRotation(0)
      setSwipeX(0)
      setDismissVisual(IDLE_DISMISS)
      setDragging(false)
    }
    else if (!isClosing) {
      setClosingIndex(null)
    }
  }

  const resolveOriginElement = useCallback((targetIdx: number): HTMLElement | null => {
    const explicit = getOriginElement?.(targetIdx)
    if (explicit?.isConnected)
      return explicit
    const item = images[targetIdx]
    return item ? findVisibleOriginBySrc(item.src) : null
  }, [getOriginElement, images])

  const measureSizes = useCallback((): { stage: Size, fitted: Size, natural: Size } => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    const stage: Size = stageRect && stageRect.width > 0
      ? { width: stageRect.width, height: stageRect.height }
      : {
          width: typeof window !== 'undefined' ? window.innerWidth : 0,
          height: typeof window !== 'undefined' ? window.innerHeight : 0,
        }
    const img = currentImageRef.current
    const fitted: Size = img
      ? { width: img.offsetWidth || img.clientWidth, height: img.offsetHeight || img.clientHeight }
      : { width: 0, height: 0 }
    const natural: Size = img
      ? { width: img.naturalWidth, height: img.naturalHeight }
      : { width: 0, height: 0 }
    return { stage, fitted, natural }
  }, [])

  // 监听舞台尺寸变化（窗口缩放、手机横竖屏旋转），保证滑轨间距与拖拽边界实时准确
  useEffect(() => {
    if (!open)
      return
    const el = stageRef.current
    if (!el)
      return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
      setTransform((prev) => {
        if (prev.scale <= SNAP_TO_IDENTITY_SCALE)
          return prev
        const { fitted } = measureSizes()
        return clampTransform(prev, fitted, { width: rect.width, height: rect.height }, rotationRef.current)
      })
    }
    update()
    if (typeof ResizeObserver === 'undefined')
      return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, measureSizes])

  // 主动回退打开时推入的临时历史记录，保持浏览器返回栈干净
  const cleanupHistoryEntry = useCallback(() => {
    if (!historyPushedRef.current)
      return
    historyPushedRef.current = false
    if (historyPoppedByUserRef.current) {
      historyPoppedByUserRef.current = false
      return
    }
    if (typeof window !== 'undefined' && window.history.state?.__neoImageViewer === historyToken) {
      ignoreNextPopStateRef.current = true
      try {
        window.history.back()
      }
      catch {
        ignoreNextPopStateRef.current = false
      }
    }
  }, [historyToken])

  // 统一关闭入口：播放缩回原图（FLIP）或顺势淡出动画后再通知父级关闭
  const requestClose = useCallback((reason: 'ui' | 'backdrop' | 'swipe' | 'escape' | 'popstate' = 'ui') => {
    if (isClosingRef.current)
      return
    const currentIdx = activeIndexRef.current
    if (currentIdx === null) {
      onIndexChange(null)
      return
    }
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
    }
    if (reason === 'popstate')
      historyPoppedByUserRef.current = true

    cleanupHistoryEntry()

    if (prefersReducedMotion()) {
      setIsClosing(false)
      setClosingIndex(null)
      onIndexChange(null)
      return
    }

    setClosingIndex(currentIdx)
    setIsClosing(true)
    setDragging(false)
    onIndexChange(null)

    const carrier = activeCarrierRef.current
    const overlay = overlayRef.current
    const imgEl = currentImageRef.current
    const originEl = resolveOriginElement(currentIdx)
    const viewport: Size = {
      width: typeof window !== 'undefined' ? window.innerWidth : 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
    }

    // 计算当前图片基础目标矩形（剥离缩放/拖拽变换，以舞台中心为基准）
    const { stage, fitted } = measureSizes()
    const baseTargetRect: Rect | null = fitted.width > 0 && stage.width > 0
      ? {
          left: (stage.width - fitted.width) / 2,
          top: (stage.height - fitted.height) / 2,
          right: (stage.width + fitted.width) / 2,
          bottom: (stage.height + fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        }
      : toRect(imgEl?.getBoundingClientRect())

    const flip = computeFlipTransform(toRect(originEl?.getBoundingClientRect()), baseTargetRect, viewport)

    if (carrier) {
      // 从当前手势/缩放视觉位置平滑飞回页面原图位置（若原图不在视口内则顺势缩小淡出）
      const startDismiss = dismissVisualRef.current
      const startTf = transformRef.current
      const startX = startTf.x + startDismiss.x
      const startY = startTf.y + startDismiss.y
      const startScale = startTf.scale * startDismiss.scale

      carrier.style.transition = 'none'
      carrier.style.transform = `translate3d(${startX}px, ${startY}px, 0) scale(${startScale})`
      carrier.style.opacity = '1'
      void carrier.offsetWidth

      carrier.style.transition = `transform ${CLOSE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${CLOSE_DURATION_MS}ms ease-out`
      if (flip) {
        carrier.style.transform = `translate3d(${flip.x}px, ${flip.y}px, 0) scale(${flip.scale})`
        carrier.style.opacity = '0.25'
      }
      else if (reason === 'swipe') {
        carrier.style.transform = `translate3d(${startX}px, ${startY + 96}px, 0) scale(${Math.max(0.6, startScale * 0.88)})`
        carrier.style.opacity = '0'
      }
      else {
        carrier.style.transform = `translate3d(${startX * 0.4}px, ${startY * 0.4}px, 0) scale(${Math.max(0.88, startScale * 0.92)})`
        carrier.style.opacity = '0'
      }
    }

    if (overlay) {
      overlay.style.transition = `opacity ${CLOSE_DURATION_MS}ms ease-out`
      overlay.style.opacity = '0'
    }

    if (closeTimerRef.current)
      clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setIsClosing(false)
      setClosingIndex(null)
      setDismissVisual(IDLE_DISMISS)
      setTransform(IDENTITY_TRANSFORM)
      setRotation(0)
      setChromeHidden(false)
    }, CLOSE_DURATION_MS)
  }, [cleanupHistoryEntry, measureSizes, onIndexChange, resolveOriginElement])

  // 卸载清理定时器
  useEffect(() => {
    return () => {
      if (closeTimerRef.current)
        clearTimeout(closeTimerRef.current)
      if (tapTimerRef.current)
        clearTimeout(tapTimerRef.current)
      if (wheelIdleTimerRef.current)
        clearTimeout(wheelIdleTimerRef.current)
    }
  }, [])

  // 移动端返回键与侧滑返回保护：打开期间拦截一次返回用于关闭图片，不直接退出文章页
  useEffect(() => {
    if (!open || isClosing || typeof window === 'undefined')
      return

    if (!historyPushedRef.current) {
      try {
        window.history.pushState({ ...(window.history.state ?? {}), __neoImageViewer: historyToken }, '')
        historyPushedRef.current = true
        historyPoppedByUserRef.current = false
      }
      catch {}
    }

    const onPopState = () => {
      if (ignoreNextPopStateRef.current) {
        ignoreNextPopStateRef.current = false
        return
      }
      if (historyPushedRef.current) {
        requestClose('popstate')
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [open, isClosing, historyToken, requestClose])

  // 若外部直接将 index 置空导致组件关闭，同步清理可能残留的历史栈
  useEffect(() => {
    if (!open && historyPushedRef.current)
      cleanupHistoryEntry()
  }, [open, cleanupHistoryEntry])

  // 打开首帧 FLIP 飞入动画 & 滑轨切图无缝位移补偿
  useLayoutEffect(() => {
    if (!open || activeIndex === null) {
      wasOpenRef.current = false
      prevActiveIndexRef.current = null
      pendingSlideCarryRef.current = null
      return
    }

    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true

    if (justOpened && !isClosing) {
      prevActiveIndexRef.current = activeIndex
      if (prefersReducedMotion())
        return

      const carrier = activeCarrierRef.current
      const overlay = overlayRef.current
      const originEl = resolveOriginElement(activeIndex)
      const originRect = toRect(originEl?.getBoundingClientRect())
      const viewport: Size = { width: window.innerWidth, height: window.innerHeight }

      // 首帧图片可能尚未完成自然尺寸测量，利用源图片比例估算舞台目标尺寸
      const { stage, fitted } = measureSizes()
      let targetRect: Rect | null = null
      if (fitted.width > 0 && fitted.height > 0 && stage.width > 0) {
        targetRect = {
          left: (stage.width - fitted.width) / 2,
          top: (stage.height - fitted.height) / 2,
          right: (stage.width + fitted.width) / 2,
          bottom: (stage.height + fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        }
      }
      else if (originRect && originRect.width > 0 && originRect.height > 0) {
        const maxW = viewport.width * 0.94
        const maxH = viewport.height * 0.84
        const scaleFit = Math.min(maxW / originRect.width, maxH / originRect.height)
        const estW = originRect.width * Math.max(1, scaleFit)
        const estH = originRect.height * Math.max(1, scaleFit)
        targetRect = {
          left: (viewport.width - estW) / 2,
          top: (viewport.height - estH) / 2,
          right: (viewport.width + estW) / 2,
          bottom: (viewport.height + estH) / 2,
          width: estW,
          height: estH,
        }
      }

      const flip = computeFlipTransform(originRect, targetRect, viewport)
      let clearCarrierTimer: ReturnType<typeof setTimeout> | null = null
      if (carrier) {
        carrier.style.transition = 'none'
        carrier.style.opacity = flip ? '0.6' : '0'
        carrier.style.transform = flip
          ? `translate3d(${flip.x}px, ${flip.y}px, 0px) scale(${flip.scale})`
          : 'translate3d(0px, 0px, 0px) scale(0.93)'
        if (overlay) {
          overlay.style.transition = 'none'
          overlay.style.opacity = '0'
        }
        void carrier.offsetWidth
        carrier.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out'
        carrier.style.opacity = '1'
        carrier.style.transform = 'translate3d(0px, 0px, 0px) scale(1)'
        if (overlay) {
          overlay.style.transition = 'opacity 220ms ease-out'
          overlay.style.opacity = ''
        }
        // 入场动画结束后清空父层 transform，确保内层高倍放大图片按原图分辨率清晰光栅化
        clearCarrierTimer = setTimeout(() => {
          if (!isClosingRef.current && carrier.isConnected) {
            carrier.style.transition = ''
            carrier.style.transform = ''
            carrier.style.opacity = ''
          }
        }, 280)
      }
      return () => {
        if (clearCarrierTimer)
          clearTimeout(clearCarrierTimer)
      }
    }

    // 相邻图片切换时：将滑轨先置于前一帧的精确屏幕坐标，再平滑过渡回 0，消除切图闪现
    const prevIdx = prevActiveIndexRef.current
    prevActiveIndexRef.current = activeIndex
    const track = trackRef.current
    const carry = pendingSlideCarryRef.current
    pendingSlideCarryRef.current = null

    if (!track || prevIdx === null || prevIdx === activeIndex || prefersReducedMotion())
      return

    const delta = activeIndex - prevIdx
    if (Math.abs(delta) === 1) {
      const width = stageSize.width || window.innerWidth
      const stride = width + SLIDE_GAP
      const startOffset = delta * stride + (carry ?? 0)
      track.style.transition = 'none'
      track.style.transform = `translate3d(${startOffset}px, 0px, 0px)`
      void track.offsetWidth
      track.style.transition = SLIDE_TRANSITION
      track.style.transform = 'translate3d(0px, 0px, 0px)'
    }
    else {
      track.style.transition = 'none'
      track.style.transform = 'translate3d(0px, 0px, 0px)'
    }
  }, [open, isClosing, activeIndex, measureSizes, resolveOriginElement, stageSize.width])

  // 当前激活缩略图自动平滑居中
  useEffect(() => {
    if (!open || activeIndex === null || !thumbsRef.current)
      return
    const activeBtn = thumbsRef.current.querySelector<HTMLElement>(`[data-thumb-index="${activeIndex}"]`)
    activeBtn?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [open, activeIndex])

  // 切换到指定序号（carrySwipeX 为松手瞬间已滑过的像素偏移，用于无缝衔接滑轨动画）
  const goTo = useCallback((nextIndex: number, carrySwipeX = 0) => {
    if (isClosingRef.current)
      return
    const bounded = Math.min(images.length - 1, Math.max(0, nextIndex))
    if (bounded === activeIndexRef.current) {
      setSwipeX(0)
      return
    }
    pendingSlideCarryRef.current = carrySwipeX
    onIndexChange(bounded)
    setTransform(IDENTITY_TRANSFORM)
    setRotation(0)
    setSwipeX(0)
    setDismissVisual(IDLE_DISMISS)
  }, [images.length, onIndexChange])

  const step = useCallback((delta: number, carrySwipeX = 0) => {
    const cur = activeIndexRef.current
    if (cur === null)
      return
    goTo(cur + delta, carrySwipeX)
  }, [goTo])

  // 以舞台中的指定屏幕坐标为锚点缩放，自动约束在可视边界内
  const zoomAt = useCallback((nextScale: number, clientX?: number, clientY?: number, immediate = false) => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    const { stage, fitted } = measureSizes()
    const px = stageRect && clientX !== undefined ? clientX - (stageRect.left + stageRect.width / 2) : 0
    const py = stageRect && clientY !== undefined ? clientY - (stageRect.top + stageRect.height / 2) : 0
    setInstantZoom(immediate)
    setTransform(prev => zoomTransformAtPoint(prev, nextScale, { x: px, y: py }, fitted, stage, rotationRef.current))
  }, [measureSizes])

  const resetView = useCallback(() => {
    setInstantZoom(false)
    setTransform(IDENTITY_TRANSFORM)
    setRotation(0)
  }, [])

  const rotateClockwise = useCallback(() => {
    setInstantZoom(false)
    const nextRotation = (rotationRef.current + 90) % 360
    setRotation(nextRotation)
    setTransform((prev) => {
      if (prev.scale <= SNAP_TO_IDENTITY_SCALE)
        return IDENTITY_TRANSFORM
      const { stage, fitted } = measureSizes()
      return clampTransform(prev, fitted, stage, nextRotation)
    })
  }, [measureSizes])

  // 键盘导航：方向键切图，+/-/0 缩放与重置，R 旋转，Esc 播放动画关闭
  useEffect(() => {
    if (!open || isClosing)
      return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      }
      else if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      }
      else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomAt(transformRef.current.scale * 1.3)
      }
      else if (event.key === '-') {
        event.preventDefault()
        zoomAt(transformRef.current.scale / 1.3)
      }
      else if (event.key === '0') {
        event.preventDefault()
        resetView()
      }
      else if (event.key === 'r' || event.key === 'R') {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          rotateClockwise()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, isClosing, resetView, rotateClockwise, step, zoomAt])

  // 原生非被动 wheel 监听：阻止触控板双指捏合把整个浏览器页面放大，并支持放大后触控板双指平移长图
  useEffect(() => {
    if (!open || isClosing)
      return
    const el = stageRef.current
    if (!el)
      return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const now = performance.now()
      const action = classifyWheelAction(
        event,
        transformRef.current.scale,
        trackpadUntilRef.current,
        now,
      )
      trackpadUntilRef.current = action.trackpadUntil

      if (action.type === 'ignore')
        return

      setInstantZoom(true)
      if (wheelIdleTimerRef.current)
        clearTimeout(wheelIdleTimerRef.current)
      wheelIdleTimerRef.current = setTimeout(() => {
        setInstantZoom(false)
      }, 120)

      if (action.type === 'pan') {
        const { stage, fitted } = measureSizes()
        setTransform(prev => clampTransform(
          { scale: prev.scale, x: prev.x + action.dx, y: prev.y + action.dy },
          fitted,
          stage,
          rotationRef.current,
        ))
      }
      else {
        const factor = Math.exp(-action.dy * (event.ctrlKey || event.metaKey ? 0.008 : 0.0022))
        zoomAt(transformRef.current.scale * factor, event.clientX, event.clientY, true)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open, isClosing, measureSizes, zoomAt])

  // 预加载相邻图片，切换更顺滑
  useEffect(() => {
    if (activeIndex === null)
      return
    for (const neighbor of [images[activeIndex - 1], images[activeIndex + 1]]) {
      if (neighbor && !loadMap[neighbor.src]) {
        const preloader = new window.Image()
        preloader.onload = () => setLoadMap(prev => (prev[neighbor.src] === 'loaded' ? prev : { ...prev, [neighbor.src]: 'loaded' }))
        preloader.src = neighbor.src
      }
    }
  }, [activeIndex, images, loadMap])

  const markImageLoaded = useCallback((src: string) => {
    setLoadMap(prev => (prev[src] === 'loaded' ? prev : { ...prev, [src]: 'loaded' }))
  }, [])

  const markImageError = useCallback((src: string) => {
    setLoadMap(prev => (prev[src] === 'error' ? prev : { ...prev, [src]: 'error' }))
  }, [])

  const captureStagePointer = (pointerId: number) => {
    const g = gesture.current
    if (g.capturedId === pointerId)
      return
    try {
      stageRef.current?.setPointerCapture(pointerId)
      g.capturedId = pointerId
    }
    catch {}
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isClosing)
      return
    // 忽略鼠标右键/中键，保留桌面端右键保存菜单，防止右键点击误关闭预览器
    if (event.pointerType === 'mouse' && event.button !== 0)
      return
    // 工具栏、翻页热区与缩略图点击不进入舞台手势
    if ((event.target as Element | null)?.closest?.('[data-viewer-ui]'))
      return

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current

    if (pointers.current.size === 1) {
      // 在任何指针捕获发生前记录原始落点是否在当前图片上，彻底杜绝 setPointerCapture 重定向 target 导致的误关
      g.startedOnImage = Boolean(currentImageRef.current?.contains(event.target as Node))
      g.startX = event.clientX
      g.startY = event.clientY
      g.rawDx = 0
      g.rawDy = 0
      g.moved = false
      g.wasMultiTouch = false
      g.capturedId = null
      g.axis = null
      g.samples = [{ x: event.clientX, y: event.clientY, t: performance.now() }]
    }
    else if (pointers.current.size === 2) {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current)
        tapTimerRef.current = null
      }
      const [a, b] = Array.from(pointers.current.values())
      g.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
      g.pinchScale = transformRef.current.scale
      g.moved = true
      g.wasMultiTouch = true
      g.axis = null
      setSwipeX(0)
      setDismissVisual(IDLE_DISMISS)
      setDragging(true)
      captureStagePointer(event.pointerId)
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last || isClosing)
      return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    const g = gesture.current
    const now = performance.now()
    g.samples.push({ x: event.clientX, y: event.clientY, t: now })
    while (g.samples.length > 2 && now - g.samples[0].t > 120)
      g.samples.shift()

    // 双指捏合缩放：以双指中点为锚点
    if (pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (g.pinchDistance > 0) {
        zoomAt((g.pinchScale * distance) / g.pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2, true)
      }
      return
    }

    if (pointers.current.size !== 1)
      return

    const dxFromStart = event.clientX - g.startX
    const dyFromStart = event.clientY - g.startY
    g.rawDx = dxFromStart
    g.rawDy = dyFromStart

    if (!g.moved) {
      if (Math.hypot(dxFromStart, dyFromStart) <= TAP_SLOP)
        return
      g.moved = true
      setDragging(true)
      // 确认进入滑动/拖拽后再捕获指针，既保证拖出窗口不断连，又不破坏移动端长按保存菜单
      captureStagePointer(event.pointerId)
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current)
        tapTimerRef.current = null
      }
    }

    const dxStep = event.clientX - last.x
    const dyStep = event.clientY - last.y

    if (transformRef.current.scale > SNAP_TO_IDENTITY_SCALE) {
      // 放大状态下：平移查看细节，并严格限制在可视舞台边界内
      const { stage, fitted } = measureSizes()
      setTransform(prev => clampTransform(
        { scale: prev.scale, x: prev.x + dxStep, y: prev.y + dyStep },
        fitted,
        stage,
        rotationRef.current,
      ))
      return
    }

    // 双指刚松开一指后的剩余单指微动不触发切图或下拉关闭，防止画面乱跳
    if (g.wasMultiTouch)
      return

    if (!g.axis)
      g.axis = lockGestureAxis(dxFromStart, dyFromStart)

    if (g.axis === 'horizontal') {
      const curIdx = activeIndexRef.current ?? 0
      const damped = applyEdgeResistance(dxFromStart, curIdx > 0, curIdx < images.length - 1)
      setSwipeX(damped)
    }
    else if (g.axis === 'vertical') {
      setDismissVisual(computeVerticalDismissVisual(dxFromStart, dyFromStart))
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    // 仅处理由舞台自身在 pointerdown 登记过的指针（忽略工具栏按钮冒泡或打开前残留的抬起事件）
    if (!pointers.current.has(event.pointerId))
      return
    pointers.current.delete(event.pointerId)
    const g = gesture.current
    if (g.capturedId === event.pointerId)
      g.capturedId = null

    // 双指抬起其中一指时：将剩余手指的当前坐标作为新起点，平滑衔接后续平移且避免跳变
    if (pointers.current.size === 1) {
      const [remaining] = Array.from(pointers.current.values())
      g.startX = remaining.x
      g.startY = remaining.y
      g.rawDx = 0
      g.rawDy = 0
      g.wasMultiTouch = true
      g.axis = null
      return
    }

    if (pointers.current.size > 0)
      return

    setDragging(false)
    setInstantZoom(false)

    if (isClosing)
      return

    // 1. 水平滑动切图结算
    if (g.axis === 'horizontal') {
      const curIdx = activeIndexRef.current ?? 0
      const { vx } = computePointerVelocity(g.samples)
      const width = stageSize.width || (typeof window !== 'undefined' ? window.innerWidth : 390)
      const dir = resolveHorizontalSwipe(g.rawDx, vx, width, curIdx > 0, curIdx < images.length - 1)
      if (dir !== 0) {
        const currentDamped = applyEdgeResistance(g.rawDx, curIdx > 0, curIdx < images.length - 1)
        step(dir, currentDamped)
      }
      else {
        setSwipeX(0)
      }
      g.axis = null
      return
    }

    // 2. 垂直下拉关闭结算
    if (g.axis === 'vertical') {
      const { vy } = computePointerVelocity(g.samples)
      if (shouldDismissOnVerticalRelease(g.rawDy, vy)) {
        g.axis = null
        requestClose('swipe')
        return
      }
      setDismissVisual(IDLE_DISMISS)
      g.axis = null
      return
    }

    // 3. 发生过拖拽或双指缩放：对齐边界即可，绝不误触发关闭
    if (g.moved || g.wasMultiTouch) {
      if (transformRef.current.scale <= SNAP_TO_IDENTITY_SCALE)
        setTransform(IDENTITY_TRANSFORM)
      return
    }

    // 4. 点击空白处：放大态下先平滑还原回 100% 防止看细节时误关；原始 1x 态下才关闭预览器
    if (!g.startedOnImage) {
      if (transformRef.current.scale > SNAP_TO_IDENTITY_SCALE) {
        resetView()
      }
      else {
        requestClose('backdrop')
      }
      return
    }

    // 5. 点击图片本身：双击智能放大/还原；触屏端单击切换沉浸式工具栏显隐
    const now = Date.now()
    const isDoubleTap = now - g.lastTapTime < DOUBLE_TAP_MS
      && Math.hypot(event.clientX - g.lastTapX, event.clientY - g.lastTapY) < DOUBLE_TAP_DISTANCE

    if (isDoubleTap) {
      g.lastTapTime = 0
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current)
        tapTimerRef.current = null
      }
      if (transformRef.current.scale > SNAP_TO_IDENTITY_SCALE) {
        resetView()
      }
      else {
        const { stage, fitted, natural } = measureSizes()
        const targetScale = computeDoubleTapScale(natural, fitted, stage)
        zoomAt(targetScale, event.clientX, event.clientY)
      }
      return
    }

    g.lastTapTime = now
    g.lastTapX = event.clientX
    g.lastTapY = event.clientY

    if (event.pointerType !== 'mouse') {
      if (tapTimerRef.current)
        clearTimeout(tapTimerRef.current)
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null
        setChromeHidden(prev => !prev)
      }, DOUBLE_TAP_MS)
    }
  }

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId))
      return
    pointers.current.delete(event.pointerId)
    if (gesture.current.capturedId === event.pointerId)
      gesture.current.capturedId = null
    if (pointers.current.size === 0) {
      setDragging(false)
      setInstantZoom(false)
      setSwipeX(0)
      setDismissVisual(IDLE_DISMISS)
      gesture.current.axis = null
    }
  }

  const stride = (stageSize.width || (typeof window !== 'undefined' ? window.innerWidth : 1024)) + SLIDE_GAP
  const canGoPrev = activeIndex !== null && activeIndex > 0
  const canGoNext = activeIndex !== null && activeIndex < images.length - 1
  const isZoomed = transform.scale > SNAP_TO_IDENTITY_SCALE
  const zoomPercent = Math.round(transform.scale * 100)
  const gestureActive = dragging && (swipeX !== 0 || dismissVisual.y !== 0)
  const hideChrome = chromeHidden || isClosing || (dismissVisual.y > 24)

  const glassPill = 'border border-white/12 bg-black/55 text-white shadow-lg backdrop-blur-md'
  const iconBtn = 'flex size-10 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 aria-disabled:opacity-30 aria-disabled:hover:bg-transparent'

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next)
          requestClose('escape')
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          ref={overlayRef}
          style={{ opacity: dismissVisual.backdropFactor < 1 ? dismissVisual.backdropFactor : undefined }}
          className="fixed inset-0 z-50 bg-black/88 transition-opacity duration-150"
        />
        <DialogPrimitive.Content
          data-image-viewer-root=""
          className="fixed inset-0 z-50 flex flex-col outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            requestClose('escape')
          }}
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>

          {current && activeIndex !== null && (
            <div
              ref={stageRef}
              data-viewer-stage=""
              className="relative size-full touch-none select-none overflow-hidden"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              {/* 三槽位跟手滑轨：同时挂载前一张/当前/后一张，滑动真实可见相邻图 */}
              <div
                ref={trackRef}
                className="relative size-full"
                style={{
                  transform: `translate3d(${swipeX}px, 0px, 0px)`,
                  transition: dragging ? 'none' : SLIDE_TRANSITION,
                }}
              >
                {([-1, 0, 1] as const).map((slotOffset) => {
                  const slotIndex = activeIndex + slotOffset
                  const item = images[slotIndex]
                  if (!item)
                    return null
                  const isActiveSlot = slotOffset === 0
                  const status = loadMap[item.src]
                  const itemTx = isActiveSlot ? transform.x + dismissVisual.x : 0
                  const itemTy = isActiveSlot ? transform.y + dismissVisual.y : 0
                  const itemScale = isActiveSlot ? transform.scale * dismissVisual.scale : 1
                  const itemRotate = isActiveSlot ? rotation : 0

                  return (
                    <div
                      key={`${slotIndex}-${item.src}`}
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                      style={{ transform: `translate3d(${slotOffset * stride}px, 0px, 0px)` }}
                    >
                      <div
                        ref={isActiveSlot ? activeCarrierRef : undefined}
                        className="flex size-full items-center justify-center"
                      >
                        {status === 'error'
                          ? (
                              <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-white/75">
                                <ImageOffIcon aria-hidden className="size-7 text-white/50" />
                                <span>{t('load_failed')}</span>
                              </div>
                            )
                          : (
                              <>
                                {!status && (
                                  <div
                                    role="status"
                                    aria-label={t('loading')}
                                    className="pointer-events-none absolute flex size-11 items-center justify-center rounded-full bg-black/45 text-white/80 backdrop-blur-sm"
                                  >
                                    <Loader2Icon aria-hidden className="size-5 animate-spin" />
                                  </div>
                                )}
                                {/* eslint-disable-next-line next/no-img-element -- 使用原图原生 img，支持移动端长按保存、桌面右键另存为及读取 naturalWidth */}
                                <img
                                  ref={(node) => {
                                    if (isActiveSlot)
                                      currentImageRef.current = node
                                    if (node?.complete && node.naturalWidth > 0 && status !== 'loaded')
                                      markImageLoaded(item.src)
                                  }}
                                  src={item.src}
                                  alt={item.alt}
                                  draggable={false}
                                  onLoad={() => markImageLoaded(item.src)}
                                  onError={() => markImageError(item.src)}
                                  className={cn(
                                    'content-image-viewer-img pointer-events-auto max-h-[84dvh] max-w-[94vw] object-contain',
                                    dragging && 'will-change-transform',
                                    isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
                                  )}
                                  style={{
                                    transform: `translate3d(${itemTx}px, ${itemTy}px, 0px) scale(${itemScale}) rotate(${itemRotate}deg)`,
                                    transition: dragging || instantZoom ? 'none' : ZOOM_TRANSITION,
                                  }}
                                />
                              </>
                            )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 顶部栏：左侧页码胶囊 + 右上角原图与独立关闭按钮（彻底远离底部放大按钮） */}
              <div
                data-viewer-ui=""
                className={cn(
                  'pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-4 transition-opacity duration-200 md:px-6 md:pt-5',
                  (hideChrome || gestureActive) && 'opacity-0 pointer-events-none',
                )}
              >
                <div>
                  {images.length > 1 && (
                    <span className={cn(glassPill, 'pointer-events-auto inline-flex h-10 items-center rounded-full px-3.5 text-sm font-medium tabular-nums text-white/90')}>
                      {`${activeIndex + 1} / ${images.length}`}
                    </span>
                  )}
                </div>

                <div className={cn(glassPill, 'pointer-events-auto flex items-center gap-1 rounded-full p-1')}>
                  <a
                    href={current.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('open_original')}
                    title={t('open_original')}
                    className={iconBtn}
                  >
                    <ExternalLinkIcon className="size-4.5" />
                  </a>
                  <button
                    type="button"
                    aria-label={t('close')}
                    title={t('close')}
                    onClick={() => requestClose('ui')}
                    className={cn(iconBtn, 'size-10 bg-white/10 hover:bg-white/22')}
                  >
                    <XIcon className="size-5" />
                  </button>
                </div>
              </div>

              {/* 左右翻页宽热区：外层承接偏差点击且禁用态保留拦截能力，绝不穿透关闭背景 */}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    data-viewer-ui=""
                    aria-label={t('previous')}
                    aria-disabled={!canGoPrev}
                    title={t('previous')}
                    onClick={() => canGoPrev && step(-1)}
                    className={cn(
                      'group absolute left-0 top-1/2 z-10 flex h-28 w-14 -translate-y-1/2 items-center justify-start pl-2.5 transition-opacity duration-200 focus-visible:outline-none md:h-40 md:w-22 md:pl-5',
                      (hideChrome || gestureActive) && 'pointer-events-none opacity-0',
                      !canGoPrev && 'cursor-default',
                    )}
                  >
                    <span
                      className={cn(
                        glassPill,
                        'flex size-11 items-center justify-center rounded-full transition-all',
                        canGoPrev
                          ? 'text-white group-hover:scale-105 group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/60'
                          : 'opacity-25',
                      )}
                    >
                      <ChevronLeftIcon className="size-5.5" />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-viewer-ui=""
                    aria-label={t('next')}
                    aria-disabled={!canGoNext}
                    title={t('next')}
                    onClick={() => canGoNext && step(1)}
                    className={cn(
                      'group absolute right-0 top-1/2 z-10 flex h-28 w-14 -translate-y-1/2 items-center justify-end pr-2.5 transition-opacity duration-200 focus-visible:outline-none md:h-40 md:w-22 md:pr-5',
                      (hideChrome || gestureActive) && 'pointer-events-none opacity-0',
                      !canGoNext && 'cursor-default',
                    )}
                  >
                    <span
                      className={cn(
                        glassPill,
                        'flex size-11 items-center justify-center rounded-full transition-all',
                        canGoNext
                          ? 'text-white group-hover:scale-105 group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/60'
                          : 'opacity-25',
                      )}
                    >
                      <ChevronRightIcon className="size-5.5" />
                    </span>
                  </button>
                </>
              )}

              {/* 底部悬浮栏：图注 + 缩放/重置/旋转胶囊 + 多图缩略图导航条 */}
              <div
                data-viewer-ui=""
                className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2.5 px-4 pb-5 pt-3 transition-opacity duration-200',
                  (hideChrome || gestureActive) && 'pointer-events-none opacity-0',
                )}
              >
                {current.caption && (
                  <p className="pointer-events-auto max-h-16 max-w-2xl overflow-y-auto rounded-xl bg-black/45 px-3.5 py-1.5 text-center text-sm leading-relaxed text-white/90 backdrop-blur-sm">
                    {current.caption}
                  </p>
                )}

                <div className={cn(glassPill, 'pointer-events-auto flex items-center gap-1 rounded-full p-1')}>
                  <button
                    type="button"
                    aria-label={t('zoom_out')}
                    aria-disabled={transform.scale <= MIN_SCALE}
                    title={t('zoom_out')}
                    onClick={() => transform.scale > MIN_SCALE && zoomAt(transform.scale / 1.4)}
                    className={iconBtn}
                  >
                    <ZoomOutIcon className="size-4.5" />
                  </button>

                  <button
                    type="button"
                    aria-label={t('reset_zoom')}
                    title={t('reset_zoom')}
                    onClick={resetView}
                    className="min-w-15 rounded-full px-2.5 py-1.5 text-center text-xs font-medium tabular-nums text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    {`${zoomPercent}%`}
                  </button>

                  <button
                    type="button"
                    aria-label={t('zoom_in')}
                    aria-disabled={transform.scale >= MAX_SCALE}
                    title={t('zoom_in')}
                    onClick={() => transform.scale < MAX_SCALE && zoomAt(transform.scale * 1.4)}
                    className={iconBtn}
                  >
                    <ZoomInIcon className="size-4.5" />
                  </button>

                  <div className="mx-0.5 h-4 w-px bg-white/15" />

                  <button
                    type="button"
                    aria-label={t('rotate')}
                    title={t('rotate')}
                    onClick={rotateClockwise}
                    className={iconBtn}
                  >
                    <RotateCwIcon className="size-4.5" />
                  </button>
                </div>

                {images.length > 1 && (
                  <div
                    ref={thumbsRef}
                    role="region"
                    aria-label={t('thumbnails')}
                    className="content-image-viewer-thumbs pointer-events-auto flex max-w-[min(92vw,36rem)] items-center gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-black/50 p-1.5 backdrop-blur-md"
                  >
                    {images.map((item, idx) => {
                      const active = idx === activeIndex
                      return (
                        <button
                          key={`${idx}-${item.src}`}
                          type="button"
                          data-thumb-index={idx}
                          aria-label={t('go_to_image', { index: idx + 1 })}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => goTo(idx)}
                          className={cn(
                            'relative size-10 shrink-0 overflow-hidden rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                            active ? 'ring-2 ring-white opacity-100' : 'opacity-45 hover:opacity-80',
                          )}
                        >
                          {/* eslint-disable-next-line next/no-img-element -- 缩略图直接复用已缓存的正文图片资源 */}
                          <img
                            src={item.src}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="size-full object-cover"
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
