'use client'

import type { ImageQuality } from '@/utils/common/image'
import { useEffect, useState } from 'react'
import { SafeImage } from '@/components/common/safe-image'
import { cn } from '@/lib/utils'
import { defaultAvatarQuality } from '@/utils/common/image'

export interface ImageAvatarProps {
  src?: string | null
  // 主图加载失败时自动尝试的备用地址（例如后端缩略缓存被上游风控拦截时回退浏览器直连原图）
  fallbackSrc?: string | null
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
  // 图片优化压缩档位；未指定时按 sizes 自动分配（小头像 45、中头像 60、大图 75）
  quality?: ImageQuality
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
export function ImageAvatar({ src, fallbackSrc, alt = '', fallback, className, imageClassName, fallbackClassName, fallbackStyle, fallbackDelayMs, sizes = '128px', eager, quality }: ImageAvatarProps) {
  const candidates = [src, fallbackSrc].filter((item, index, list): item is string =>
    !!item && list.indexOf(item) === index)
  const candidateKey = candidates.join('\n')
  // 记录当前候选链的失败级数与加载完成态，地址变化时自动重置
  const [state, setState] = useState<{ key: string, failedCount: number, loaded: boolean }>({
    key: candidateKey,
    failedCount: 0,
    loaded: false,
  })
  const failedCount = state.key === candidateKey ? state.failedCount : 0
  const loaded = state.key === candidateKey ? state.loaded : false
  const activeSrc = candidates[failedCount]
  const status: LoadStatus = !activeSrc ? 'error' : loaded ? 'loaded' : 'loading'
  const [delayPassed, setDelayPassed] = useState(!fallbackDelayMs)
  useEffect(() => {
    if (!fallbackDelayMs || !activeSrc)
      return
    setDelayPassed(false)
    const timer = window.setTimeout(setDelayPassed, fallbackDelayMs, true)
    return () => window.clearTimeout(timer)
  }, [fallbackDelayMs, activeSrc])
  const showFallback = status === 'error' || (status === 'loading' && (failedCount > 0 || delayPassed))

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
      {activeSrc && (
        <SafeImage
          key={activeSrc}
          src={activeSrc}
          alt={alt}
          fill
          sizes={sizes}
          quality={quality ?? defaultAvatarQuality(sizes)}
          loading={eager ? 'eager' : undefined}
          // 失败时不显示 SafeImage 的占位块，换成本组件的兜底内容
          fallback={null}
          data-slot="avatar-image"
          // text-transparent：水合前就加载失败时不露出替代文字（水合后换成兜底内容）
          className={cn('aspect-square size-full object-cover text-transparent', imageClassName)}
          // 水合前就结束的图片由 next/image 重放回调：有固有尺寸直接标记成功；naturalWidth === 0 时用 img.decode() 区分合法无宽高 SVG 与水合前 404 坏图
          onLoad={(event) => {
            const imgEl = event.currentTarget
            if (imgEl.naturalWidth > 0) {
              setState({ key: candidateKey, failedCount, loaded: true })
              return
            }
            if (typeof imgEl.decode === 'function') {
              imgEl.decode().then(
                () => {
                  setState(prev => (prev.key === candidateKey && prev.failedCount === failedCount)
                    ? { key: candidateKey, failedCount, loaded: true }
                    : prev)
                },
                () => {
                  setState(prev => (prev.key === candidateKey && prev.failedCount === failedCount)
                    ? { key: candidateKey, failedCount: failedCount + 1, loaded: false }
                    : prev)
                },
              )
              return
            }
            setState({ key: candidateKey, failedCount: failedCount + 1, loaded: false })
          }}
          onError={() => setState({ key: candidateKey, failedCount: failedCount + 1, loaded: false })}
        />
      )}
    </span>
  )
}
