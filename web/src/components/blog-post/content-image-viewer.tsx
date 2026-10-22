'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronLeftIcon, ChevronRightIcon, XIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import './content-image-viewer.scss'

interface ViewerImage {
  src: string
  alt: string
  caption: string
}

interface Transform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2
const SWIPE_THRESHOLD = 60 // 横向滑动超过该距离切换图片
const TAP_SLOP = 6 // 移动小于该距离视为点击
const DOUBLE_TAP_MS = 300
const IDENTITY: Transform = { scale: 1, x: 0, y: 0 }

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/**
 * 正文图片预览：点击正文图片全屏查看，全文图片作为列表
 * - 左右按钮、键盘方向键、横向滑动切换
 * - 滚轮、双指、双击/双击触摸缩放，放大后可拖动
 * - 点击图片以外区域、底部关闭按钮或 Esc 关闭
 * - 预览使用原生 <img>，桌面右键、移动端长按均可保存
 */
export function ContentImageViewer({ containerId }: { containerId: string }) {
  const t = useTranslations('ImageViewer')
  const [images, setImages] = useState<ViewerImage[]>([])
  const [index, setIndex] = useState<number | null>(null)
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [swipeX, setSwipeX] = useState(0)
  const [dragging, setDragging] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const transformRef = useRef(transform)
  transformRef.current = transform
  const pointers = useRef(new Map<number, { x: number, y: number }>())
  const gesture = useRef<{ startX: number, startY: number, moved: boolean, pinchDistance: number, pinchScale: number, lastTap: number }>({
    startX: 0,
    startY: 0,
    moved: false,
    pinchDistance: 0,
    pinchScale: 1,
    lastTap: 0,
  })

  const open = index !== null
  const current = index !== null ? images[index] : null

  // 点击正文图片打开预览，链接内的图片保持原有跳转
  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return
    const onClick = (event: MouseEvent) => {
      const img = (event.target as Element | null)?.closest?.('img')
      if (!(img instanceof HTMLImageElement) || !container.contains(img) || img.closest('a'))
        return
      // 懒加载尚未加载的图片 currentSrc 为空，回退到 src 属性
      const list = Array.from(container.querySelectorAll('img')).filter(item => !item.closest('a') && (item.currentSrc || item.getAttribute('src')))
      const clicked = list.indexOf(img)
      if (clicked < 0)
        return
      event.preventDefault()
      setImages(list.map(item => ({
        src: item.currentSrc || item.src,
        alt: item.alt,
        caption: item.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || item.alt,
      })))
      setTransform(IDENTITY)
      setIndex(clicked)
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [containerId])

  // 基于最新序号切换，连续按键/快速点击时不会因为闭包里的旧序号而少切换
  const step = useCallback((delta: number) => {
    setIndex(prev => (prev === null ? prev : Math.min(images.length - 1, Math.max(0, prev + delta))))
    setTransform(IDENTITY)
    setSwipeX(0)
  }, [images.length])

  // 以舞台中的某个点为中心缩放，使该点在缩放前后保持不动
  const zoomAt = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current?.getBoundingClientRect()
    const prev = transformRef.current
    const scale = clampScale(nextScale)
    if (scale === MIN_SCALE) {
      setTransform(IDENTITY)
      return
    }
    const px = stage && clientX !== undefined ? clientX - (stage.left + stage.width / 2) : 0
    const py = stage && clientY !== undefined ? clientY - (stage.top + stage.height / 2) : 0
    const ratio = scale / prev.scale
    setTransform({ scale, x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio })
  }, [])

  // 键盘：左右切换，+/- 缩放（Esc 由 Dialog 处理）
  useEffect(() => {
    if (!open)
      return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft')
        step(-1)
      else if (event.key === 'ArrowRight')
        step(1)
      else if (event.key === '+' || event.key === '=')
        zoomAt(transformRef.current.scale * 1.25)
      else if (event.key === '-')
        zoomAt(transformRef.current.scale / 1.25)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, step, zoomAt])

  // 预加载相邻图片，切换更顺滑
  useEffect(() => {
    if (index === null)
      return
    for (const neighbor of [images[index - 1], images[index + 1]]) {
      if (neighbor)
        new window.Image().src = neighbor.src
    }
  }, [index, images])

  const close = () => setIndex(null)

  const onWheel = (event: React.WheelEvent) => {
    zoomAt(transformRef.current.scale * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    // 捕获指针保证拖出舞台也能收到事件；指针已失效时会抛错，忽略即可
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    catch {}
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (pointers.current.size === 1) {
      g.startX = event.clientX
      g.startY = event.clientY
      g.moved = false
    }
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values())
      g.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
      g.pinchScale = transformRef.current.scale
      g.moved = true
    }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId)
    if (!last)
      return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > TAP_SLOP)
      g.moved = true

    // 双指缩放，以两指中点为中心
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (g.pinchDistance > 0)
        zoomAt(g.pinchScale * distance / g.pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }
    if (pointers.current.size !== 1)
      return
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    if (transformRef.current.scale > MIN_SCALE) {
      // 放大后拖动查看细节
      setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
    }
    else {
      // 未放大时横向滑动切换图片
      setSwipeX(event.clientX - g.startX)
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size > 0)
      return
    setDragging(false)
    const g = gesture.current
    const dx = event.clientX - g.startX

    if (transformRef.current.scale === MIN_SCALE && Math.abs(swipeX) > SWIPE_THRESHOLD)
      step(dx < 0 ? 1 : -1)
    setSwipeX(0)
    if (g.moved)
      return

    // 点击图片以外区域关闭；在图片上双击/双击触摸切换放大
    const onImage = imageRef.current?.contains(event.target as Node)
    if (!onImage) {
      close()
      return
    }
    const now = Date.now()
    if (now - g.lastTap < DOUBLE_TAP_MS) {
      g.lastTap = 0
      if (transformRef.current.scale > MIN_SCALE)
        setTransform(IDENTITY)
      else
        zoomAt(DOUBLE_TAP_SCALE, event.clientX, event.clientY)
    }
    else {
      g.lastTap = now
    }
  }

  const onPointerCancel = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) {
      setDragging(false)
      setSwipeX(0)
    }
  }

  const controlButton = 'flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30'

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>
          {current && (
            <>
              {/* 图片舞台：处理切换、缩放、拖动与点击空白关闭 */}
              <div
                ref={stageRef}
                className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                {/* 使用原生 img，以支持移动端长按、桌面右键保存 */}
                <img
                  ref={imageRef}
                  key={current.src}
                  src={current.src}
                  alt={current.alt}
                  draggable={false}
                  className={cn('content-image-viewer-img max-h-[85vh] max-w-[92vw] object-contain', !dragging && 'transition-transform duration-200 ease-out')}
                  style={{ transform: `translate(${transform.x + swipeX}px, ${transform.y}px) scale(${transform.scale})` }}
                />
                {images.length > 1 && (
                  <>
                    <button type="button" aria-label={t('previous')} className={cn(controlButton, 'absolute left-3 top-1/2 -translate-y-1/2 md:left-6')} disabled={index === 0} onPointerDown={e => e.stopPropagation()} onClick={() => step(-1)}>
                      <ChevronLeftIcon className="size-5" />
                    </button>
                    <button type="button" aria-label={t('next')} className={cn(controlButton, 'absolute right-3 top-1/2 -translate-y-1/2 md:right-6')} disabled={index === images.length - 1} onPointerDown={e => e.stopPropagation()} onClick={() => step(1)}>
                      <ChevronRightIcon className="size-5" />
                    </button>
                  </>
                )}
              </div>

              {/* 底部：注释、序号、缩放与关闭 */}
              <div className="flex flex-col items-center gap-3 px-4 pb-6 pt-2 text-white">
                {current.caption && <p className="max-w-2xl text-center text-sm text-white/80 line-clamp-2">{current.caption}</p>}
                <div className="flex items-center gap-3">
                  <button type="button" aria-label={t('zoom_out')} className={controlButton} disabled={transform.scale <= MIN_SCALE} onClick={() => zoomAt(transform.scale / 1.5)}>
                    <ZoomOutIcon className="size-5" />
                  </button>
                  {images.length > 1 && <span className="min-w-14 text-center text-sm tabular-nums text-white/80">{`${index! + 1} / ${images.length}`}</span>}
                  <button type="button" aria-label={t('zoom_in')} className={controlButton} disabled={transform.scale >= MAX_SCALE} onClick={() => zoomAt(transform.scale * 1.5)}>
                    <ZoomInIcon className="size-5" />
                  </button>
                  <DialogPrimitive.Close aria-label={t('close')} className={cn(controlButton, 'ml-2')}>
                    <XIcon className="size-5" />
                  </DialogPrimitive.Close>
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
