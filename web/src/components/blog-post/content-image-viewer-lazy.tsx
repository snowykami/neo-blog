'use client'

import type { ImageViewer as ImageViewerComponent, ViewerImage } from './content-image-viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { getVisibleElementById } from '@/utils/client/dom'

type ImageViewerType = typeof ImageViewerComponent

const loadViewer = () => import('./content-image-viewer').then(m => m.ImageViewer)

/**
 * 正文图片预览的入口：点击正文图片全屏查看，全文图片作为列表（预览本身见 content-image-viewer.tsx）。
 * 预览器（手势、缩放、过渡动画，约 60 KB 源码）不进首屏包：页面空闲时预先加载，加载好之前点击的图片等加载完再打开
 */
export function ContentImageViewer({ containerId }: { containerId: string }) {
  const [images, setImages] = useState<ViewerImage[]>([])
  const [index, setIndex] = useState<number | null>(null)
  const [Viewer, setViewer] = useState<ImageViewerType | null>(null)
  const viewerRef = useRef<ImageViewerType | null>(null)
  const originElementsRef = useRef<HTMLImageElement[]>([])

  const load = useCallback(() => loadViewer().then((viewer) => {
    viewerRef.current = viewer
    // 组件本身作为状态值，要用函数形式设置
    setViewer(() => viewer)
    return viewer
  }), [])

  // 空闲时预先加载：之后点击图片时预览器已经挂着（序号为空、不显示），打开时照常播放过渡动画
  useEffect(() => {
    const start = () => void load().catch(() => {})
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 5000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(start, 2000)
    return () => window.clearTimeout(timer)
  }, [load])

  // 点击正文图片打开预览，链接内与组件岛内的图片保持原有交互
  useEffect(() => {
    const container = getVisibleElementById(containerId)
    if (!container)
      return
    const onClick = (event: MouseEvent) => {
      const img = (event.target as Element | null)?.closest?.('img')
      if (!(img instanceof HTMLImageElement) || !container.contains(img) || img.closest(`a, ${COMPONENT_ROOT_SELECTOR}`))
        return
      // 懒加载尚未加载的图片 currentSrc 为空，回退到 src 属性；组件岛内的图片（封面、头像）不参与预览
      const list = Array.from(container.querySelectorAll('img')).filter(
        item => !item.closest(`a, ${COMPONENT_ROOT_SELECTOR}`) && (item.currentSrc || item.getAttribute('src')),
      )
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
      if (viewerRef.current)
        setIndex(clicked)
      else
        void load().then(() => setIndex(clicked), () => {})
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [containerId, load])

  const getOriginElement = useCallback((i: number) => originElementsRef.current[i] ?? null, [])

  if (!Viewer)
    return null
  return (
    <Viewer
      images={images}
      index={index}
      onIndexChange={setIndex}
      getOriginElement={getOriginElement}
    />
  )
}
