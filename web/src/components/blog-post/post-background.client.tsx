'use client'

import { useEffect } from 'react'
import { usePageBackground } from '@/contexts/page-background-context'

/**
 * 文章专属背景图。
 *
 * 只做一件事：把这篇文章配的背景图交给全站背景层，离开页面时撤销覆盖、
 * 重新跟随站点配置。模糊度、遮罩强度仍然沿用全站设置，所以这里不需要额外参数。
 * 文章没配图时什么都不做（渲染 null，也不产生任何副作用）。
 */
export function PostBackground({ image }: { image?: string | null }) {
  const { setPageBackground } = usePageBackground()
  const src = (image ?? '').trim()

  useEffect(() => {
    if (!src)
      return
    setPageBackground({ image: src })
    return () => setPageBackground(null)
  }, [src, setPageBackground])

  return null
}
