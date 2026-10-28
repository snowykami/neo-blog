'use client'

import { useEffect } from 'react'
import { useNav } from '@/contexts/nav-context'

/**
 * 全屏页面的标记：挂载时让顶栏收起为手势条并隐藏页脚，离开页面时恢复。
 * 放在全屏页面（如设置了「全屏」的独立页面）的内容中即可，只输出一段隐藏普通顶栏与页脚的样式
 */
export function FullscreenChrome() {
  const { setFullscreen } = useNav()
  useEffect(() => {
    setFullscreen(true)
    return () => setFullscreen(false)
  }, [setFullscreen])
  // 水合前（服务端渲染的首屏）先隐藏普通顶栏与页脚，避免切换为收起状态前闪一下
  return <style>{'[data-site-header="sticky"],[data-site-footer]{display:none}'}</style>
}
