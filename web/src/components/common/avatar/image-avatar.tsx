'use client'

import { useEffect, useState } from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { cn } from '@/lib/utils'

export interface ImageAvatarProps {
  src?: string | null
  alt?: string
  // 图片缺失或加载失败时显示的内容（首字母、图标等）
  fallback?: React.ReactNode
  className?: string
  imageClassName?: string
  fallbackClassName?: string
  fallbackStyle?: React.CSSProperties
  // 有图片时兜底内容延迟多久才显示：图片多半很快加载完（已缓存），不先闪一下首字母再换成图片；图片加载失败时照常显示
  fallbackDelayMs?: number
  // 头像的显示宽度（next/image 的 sizes），据此取合适尺寸的图片；默认 128px
  sizes?: string
  // 首屏可见的大图（如侧栏的站长头像）：不懒加载，HTML 解析到就开始下载
  eager?: boolean
}

type LoadStatus = 'loading' | 'loaded' | 'error'

/**
 * 通用图片头像：任意图片 + 兜底内容，不限于用户
 * 用于第三方登录提供商图标、站点图标等；用户头像请使用 UserAvatar
 *
 * 图片用 SafeImage（next/image）渲染，服务端渲染的 HTML 里就有 \<img\>，浏览器解析到即开始下载；
 * 站内图片按 sizes 取缩小后的尺寸。不用 Radix Avatar：它要等水合后在 effect 里预加载成功才挂上 \<img\>，
 * 头像（尤其是首屏侧栏的站长头像）要等整页脚本下载、执行完才开始加载
 */
export function ImageAvatar({ src, alt = '', fallback, className, imageClassName, fallbackClassName, fallbackStyle, fallbackDelayMs, sizes = '128px', eager }: ImageAvatarProps) {
  // 记录对应的地址，地址变化时自动回到加载中
  const [state, setState] = useState<{ src?: string | null, status: LoadStatus }>({ src, status: 'loading' })
  const status: LoadStatus = !src ? 'error' : state.src === src ? state.status : 'loading'
  const [delayPassed, setDelayPassed] = useState(!fallbackDelayMs)
  useEffect(() => {
    if (!fallbackDelayMs || !src)
      return
    setDelayPassed(false)
    const timer = window.setTimeout(setDelayPassed, fallbackDelayMs, true)
    return () => window.clearTimeout(timer)
  }, [fallbackDelayMs, src])
  const showFallback = status === 'error' || (status === 'loading' && delayPassed)

  return (
    <span data-slot="avatar" className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}>
      {showFallback && (
        <span
          data-slot="avatar-fallback"
          className={cn('bg-muted absolute inset-0 flex size-full items-center justify-center rounded-[inherit]', fallbackClassName)}
          style={fallbackStyle}
        >
          {fallback}
        </span>
      )}
      {src && status !== 'error' && (
        <SafeImage
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          loading={eager ? 'eager' : undefined}
          // 失败时不显示 SafeImage 的占位块，换成本组件的兜底内容
          fallback={null}
          data-slot="avatar-image"
          // text-transparent：水合前就加载失败时不露出替代文字（水合后换成兜底内容）
          className={cn('aspect-square size-full object-cover text-transparent', imageClassName)}
          // 加载失败的图片在水合前就「加载完」时，next/image 也会按加载成功回调，这里按图片实际尺寸再判断一次
          onLoad={event => setState({ src, status: event.currentTarget.naturalWidth > 0 ? 'loaded' : 'error' })}
          onError={() => setState({ src, status: 'error' })}
        />
      )}
    </span>
  )
}
