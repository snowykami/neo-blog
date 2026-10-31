'use client'

import type { PostBackground as PostBackgroundConfig } from '@/models/post'
import { useEffect } from 'react'
import { usePageBackground } from '@/contexts/page-background-context'

/**
 * 文章专属背景。
 *
 * 把这篇文章配的背景（图、模糊、图片不透明度、蒙版颜色与不透明度）整体交给全站背景层，
 * 离开页面时撤销覆盖、重新跟随站点配置。整段都没配时什么都不做（渲染 null，无副作用）。
 */
export function PostBackground({ background }: { background?: PostBackgroundConfig | null }) {
  const { setPageBackground } = usePageBackground()
  const src = (background?.image ?? '').trim()
  const veilColor = (background?.veilColor ?? '').trim()
  const blur = background?.blur ?? 0
  const opacity = background?.opacity ?? 1
  const veil = background?.veil ?? 0.72
  const active = Boolean(src || veilColor)

  useEffect(() => {
    if (!active)
      return
    setPageBackground({
      image: src,
      blur,
      opacity,
      veil,
      ...(veilColor ? { veilColor } : {}),
    })
    return () => setPageBackground(null)
  }, [active, src, veilColor, blur, opacity, veil, setPageBackground])

  return null
}
