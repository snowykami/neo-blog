'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlaceholder } from '@/components/common/safe-image'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'

interface FailedImage {
  id: number
  holder: HTMLElement
  label: string
}

let nextFailedImageId = 0

/**
 * 正文图片兜底：正文为后端 HTML，失效的 <img> 会被替换为同尺寸、同对齐的占位块
 * 占位块通过 portal 渲染 ImagePlaceholder，与站内其他图片兜底保持一致
 */
export function ContentImageFallback({ containerId }: { containerId: string }) {
  const t = useTranslations('Common')
  const [failed, setFailed] = useState<FailedImage[]>([])
  const defaultLabel = t('image_load_failed')

  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return

    const replace = (img: HTMLImageElement) => {
      // 组件岛内的图片由组件自己处理加载失败（React 管理的 DOM 不能被替换）
      if (!img.isConnected || img.closest(COMPONENT_ROOT_SELECTOR))
        return
      const holder = document.createElement('div')
      holder.className = 'image-fallback'
      const align = img.getAttribute('data-align')
      if (align)
        holder.dataset.align = align
      // 保留原图尺寸，避免版面跳动
      const width = Number.parseInt(img.getAttribute('width') ?? '', 10)
      const height = Number.parseInt(img.getAttribute('height') ?? '', 10)
      if (width > 0)
        holder.style.width = `${width}px`
      if (width > 0 && height > 0)
        holder.style.aspectRatio = `${width} / ${height}`
      img.replaceWith(holder)
      const failedImage = { id: nextFailedImageId++, holder, label: img.getAttribute('alt')?.trim() || defaultLabel }
      setFailed(prev => [...prev, failedImage])
    }

    // error 事件不冒泡，需在捕获阶段监听
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement)
        replace(event.target)
    }
    container.addEventListener('error', onError, true)
    // 脚本执行前就已加载失败的图片
    container.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && img.naturalHeight === 0)
        replace(img)
    })
    return () => container.removeEventListener('error', onError, true)
  }, [containerId, defaultLabel])

  return failed.map(({ id, holder, label }) => createPortal(
    <ImagePlaceholder label={label} className="size-full rounded-[inherit]">
      <span className="max-w-full px-2 text-center text-xs line-clamp-2">{label}</span>
    </ImagePlaceholder>,
    holder,
    id,
  ))
}
