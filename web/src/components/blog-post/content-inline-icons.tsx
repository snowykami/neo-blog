'use client'

import { useEffect } from 'react'
import { INLINE_ICON_ATTR, INLINE_ICON_SELECTOR, loadIconSvg } from '@/lib/inline-icon/icon'
import { getVisibleElementById } from '@/utils/client/dom'

/**
 * 在浏览器里渲染的正文（页面本地预览、版本历史预览）中填入行内图标的 SVG，按需加载用到的图标
 * 前台正文已在服务端填好（utils/server/render-content.ts），不需要这个组件
 */
export function ContentInlineIcons({ containerId }: { containerId: string }) {
  useEffect(() => {
    const container = getVisibleElementById(containerId)
    if (!container)
      return
    let cancelled = false
    const fill = () => {
      for (const el of container.querySelectorAll<HTMLElement>(`${INLINE_ICON_SELECTOR}:empty`)) {
        void loadIconSvg(el.getAttribute(INLINE_ICON_ATTR) ?? '').then((svg) => {
          if (!cancelled && svg && !el.firstChild)
            el.innerHTML = svg
        })
      }
    }
    fill()
    // 正文内容替换（如切换预览的版本）后重新填入
    const observer = new MutationObserver(fill)
    observer.observe(container, { childList: true, subtree: true })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [containerId])

  return null
}
