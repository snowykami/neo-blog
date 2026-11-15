'use client'

import type { ViewerImage } from './content-image-viewer'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { getVisibleElementById } from '@/utils/client/dom'

const LazyImageViewer = dynamic(() => import('./content-image-viewer').then(m => m.ImageViewer), {
  ssr: false,
})

function collectPreviewableImages(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll('img')).filter(
    item => !item.closest(`a, ${COMPONENT_ROOT_SELECTOR}`) && Boolean(item.currentSrc || item.getAttribute('src')),
  )
}

/**
 * 正文图片预览的入口：点击正文图片全屏查看，全文图片作为列表（预览本身见 content-image-viewer.tsx）。
 * 预览器（手势、缩放、过渡动画，约 60 KB 源码）不进首屏包：仅当正文内存在可预览图片时才在空闲时预加载或点击后挂载
 */
export function ContentImageViewer({ containerId }: { containerId: string }) {
  const [images, setImages] = useState<ViewerImage[]>([])
  const [index, setIndex] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const originElementsRef = useRef<HTMLImageElement[]>([])

  // 仅当正文容器内确实存在可预览 <img> 时才启用预览与空闲预加载，纯文字文章不加载预览器分包
  useEffect(() => {
    const container = getVisibleElementById(containerId)
    if (!container || collectPreviewableImages(container).length === 0)
      return

    let cancelIdle: (() => void) | undefined
    const schedulePreload = () => {
      const start = () => setMounted(true)
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(start, { timeout: 5000 })
        cancelIdle = () => window.cancelIdleCallback(id)
      }
      else {
        const timer = window.setTimeout(start, 2000)
        cancelIdle = () => window.clearTimeout(timer)
      }
    }
    schedulePreload()

    const onClick = (event: MouseEvent) => {
      const img = (event.target as Element | null)?.closest?.('img')
      if (!(img instanceof HTMLImageElement) || !container.contains(img) || img.closest(`a, ${COMPONENT_ROOT_SELECTOR}`))
        return
      // 懒加载尚未加载的图片 currentSrc 为空，回退到 src 属性；组件岛内的图片（封面、头像）不参与预览
      const list = collectPreviewableImages(container)
      const clicked = list.indexOf(img)
      if (clicked < 0)
        return
      event.preventDefault()
      originElementsRef.current = list
      setImages(list.map(item => ({
        src: item.currentSrc || item.src,
        alt: item.alt,
        caption: item.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || item.alt,
      })))
      setMounted(true)
      setIndex(clicked)
    }
    container.addEventListener('click', onClick)
    return () => {
      cancelIdle?.()
      container.removeEventListener('click', onClick)
    }
  }, [containerId])

  const getOriginElement = useCallback((i: number) => originElementsRef.current[i] ?? null, [])

  if (!mounted)
    return null
  return (
    <LazyImageViewer
      images={images}
      index={index}
      onIndexChange={setIndex}
      getOriginElement={getOriginElement}
    />
  )
}
