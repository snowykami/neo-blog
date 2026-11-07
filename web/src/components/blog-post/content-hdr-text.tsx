'use client'

import { useEffect } from 'react'
import { useHdrEnabled } from '@/hooks/use-hdr-highlight'
import { HDR_BRIGHTNESS, hdrColorUrl } from '@/lib/hdr-color'
import './content-hdr-text.scss'

const HDR_SELECTOR = '[data-hdr]'
const HDR_CLASS = 'content-hdr'

/**
 * 正文 HDR 文字：编辑器里标记为 HDR 的文字（<span data-hdr>，见 tiptap-extension/hdr-text-extension.ts）
 * 在 HDR 屏幕上按字本来的颜色亮过 SDR 白（HDR_BRIGHTNESS.contentText 倍）。
 * 做法同音乐播放器的歌词：HDR PNG 作背景图 + background-clip: text，字本身透明（见 lib/hdr-color.ts）。
 * 复用播放器的 HDR 高光开关，且只在暗色模式下生效（亮色背景本身就接近 SDR 白，再亮只会刺眼）
 */
export function ContentHdrText({ containerId }: { containerId: string }) {
  const enabled = useHdrEnabled()

  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return
    const root = document.documentElement

    // HDR 文字及其后代（文字颜色等内联标记可能嵌在里面，各自按自己的颜色出图）
    const targets = () => Array.from(container.querySelectorAll<HTMLElement>(HDR_SELECTOR))
      .flatMap(el => [el, ...el.querySelectorAll<HTMLElement>('*')])

    const clear = (els: HTMLElement[]) => {
      for (const el of els) {
        el.classList.remove(HDR_CLASS)
        el.style.removeProperty('--content-hdr')
        el.style.removeProperty('--content-hdr-color')
      }
    }

    const apply = () => {
      const els = targets()
      // 先全部还原再读颜色：带着 content-hdr 时字是透明的
      clear(els)
      if (!enabled || !root.classList.contains('dark'))
        return
      const colors = els.map(el => getComputedStyle(el).color)
      els.forEach((el, i) => {
        const url = hdrColorUrl(colors[i], HDR_BRIGHTNESS.contentText)
        if (!url)
          return
        el.style.setProperty('--content-hdr', `url("${url}")`)
        el.style.setProperty('--content-hdr-color', colors[i])
        el.classList.add(HDR_CLASS)
      })
    }

    apply()
    // 切换明暗主题（html 的 class）与正文后续注入的内容；只观察子节点与 html 的 class，改样式不会触发自身
    const observer = new MutationObserver(apply)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    observer.observe(container, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      clear(targets())
    }
  }, [containerId, enabled])

  return null
}
