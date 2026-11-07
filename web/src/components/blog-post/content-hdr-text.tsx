'use client'

import { useEffect } from 'react'
import { useHdrEnabled } from '@/hooks/use-hdr-highlight'
import { HDR_BRIGHTNESS, hdrColorUrl, hdrTextLevel } from '@/lib/hdr-color'
import { INLINE_ICON_SELECTOR } from '@/lib/inline-icon/constants'
import './content-hdr-text.scss'

const HDR_SELECTOR = '[data-hdr]'
const HDR_CLASS = 'content-hdr'

/**
 * 行内图标没有文字可供 background-clip: text 裁剪：把图标的 SVG（含当前的笔画粗细）转成遮罩，露出 HDR 背景
 * 还没填入 SVG 的图标返回 null，不做 HDR
 */
function iconMaskUrl(icon: HTMLElement): string | null {
  const svg = icon.querySelector('svg')
  if (!svg)
    return null
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('stroke-width', String(Number.parseFloat(getComputedStyle(svg).strokeWidth) || 2))
  return `url("data:image/svg+xml,${encodeURIComponent(clone.outerHTML)}")`
}

/**
 * 正文 HDR 文字：编辑器里标记为 HDR 的文字（<span data-hdr>，见 tiptap-extension/hdr-text-extension.ts）
 * 在 HDR 屏幕上按字本来的颜色亮过 SDR 白，倍数按 data-hdr 的档位取 HDR_BRIGHTNESS.contentText。
 * 做法同音乐播放器的歌词：HDR PNG 作背景图 + background-clip: text，字本身透明（见 lib/hdr-color.ts）。
 * 复用播放器的 HDR 高光开关，且只在暗色模式下生效（亮色背景本身就接近 SDR 白，再亮只会刺眼）
 * HDR 文字中的行内图标改用遮罩（iconMaskUrl），和文字一起发光
 */
export function ContentHdrText({ containerId }: { containerId: string }) {
  const enabled = useHdrEnabled()

  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return
    const root = document.documentElement

    // HDR 文字及其后代（文字颜色等内联标记可能嵌在里面，各自按自己的颜色出图）；图标内部的 SVG 元素随图标整体处理
    const targets = () => Array.from(container.querySelectorAll<HTMLElement>(HDR_SELECTOR))
      .flatMap(el => [el, ...el.querySelectorAll<HTMLElement>('*')])
      .filter(el => !(el instanceof SVGElement))

    const clear = (els: HTMLElement[]) => {
      for (const el of els) {
        el.classList.remove(HDR_CLASS)
        el.style.removeProperty('--content-hdr')
        el.style.removeProperty('--content-hdr-color')
        el.style.removeProperty('--content-hdr-mask')
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
        // 后代跟随最近一层 HDR 标记的档位
        const level = hdrTextLevel(el.closest(HDR_SELECTOR)?.getAttribute('data-hdr'))
        const url = hdrColorUrl(colors[i], HDR_BRIGHTNESS.contentText[level - 1])
        if (!url)
          return
        if (el.matches(INLINE_ICON_SELECTOR)) {
          const mask = iconMaskUrl(el)
          if (!mask)
            return
          el.style.setProperty('--content-hdr-mask', mask)
        }
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
