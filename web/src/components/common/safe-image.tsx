'use client'

import type { ImageProps } from 'next/image'
import { ImageOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'
import { useImageOptimizeHosts } from '@/contexts/image-optimize-context'
import { cn } from '@/lib/utils'
import { shouldOptimize } from '@/utils/common/image'

/**
 * 图片占位：图片为空或加载失败时显示，尺寸由调用方通过 className/style 决定
 */
export function ImagePlaceholder({
  className,
  style,
  label,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  label?: string
  children?: React.ReactNode
}) {
  const t = useTranslations('Common')
  return (
    <div
      role="img"
      aria-label={label || t('image_load_failed')}
      className={cn('flex flex-col items-center justify-center gap-1 overflow-hidden bg-muted text-muted-foreground', className)}
      style={style}
    >
      <ImageOffIcon className="size-[40%] max-h-8 max-w-8 min-h-3 min-w-3 shrink-0" aria-hidden="true" />
      {children}
    </div>
  )
}

export type SafeImageProps = Omit<ImageProps, 'src' | 'alt'> & {
  src?: ImageProps['src'] | null
  alt?: string
  // 原图失败后尝试的备用图，例如站点默认封面
  fallbackSrc?: string | null
  // 所有图片都不可用时显示的内容，默认为占位块；传 null 则不渲染
  fallback?: React.ReactNode
}

function srcKey(src: SafeImageProps['src']) {
  if (!src)
    return ''
  return typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src
}

// 站内文件默认 302 跳转到公开存储，Next.js /_next/image 内部抓图不允许 3xx 重定向；
// 仅在经 /_next/image 优化时附带 proxy=1 让后端直出字节流，直连或降级重试仍用原地址保留 CDN 302
function withInternalFileProxy(src: ImageProps['src']): ImageProps['src'] {
  if (typeof src !== 'string' || !src.startsWith('/api/v1/file/f/'))
    return src
  const [base, hash] = src.split('#', 2)
  if (/(?:^|[?&])proxy=/.test(base))
    return src
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}proxy=1${hash ? `#${hash}` : ''}`
}

/**
 * 带兜底的图片：原图 → 备用图 → 占位块，每一级只尝试一次；src 变化后重新从原图开始
 */
export function SafeImage({
  src,
  fallbackSrc,
  fallback,
  alt = '',
  onError,
  priority,
  preload,
  loading,
  fetchPriority,
  ...props
}: SafeImageProps) {
  const optimizeHosts = useImageOptimizeHosts()
  // 去掉空值与重复地址，避免同一个失效地址被重复尝试
  const candidates = [src, fallbackSrc].filter((item, index, list): item is ImageProps['src'] =>
    !!item && list.findIndex(other => srcKey(other) === srcKey(item)) === index)
  const key = srcKey(src)
  // 记录失败次数与是否已降级直连原图，原图变化时自动重置
  const [failure, setFailure] = useState({ key, count: 0, directFallback: false })
  const failedCount = failure.key === key ? failure.count : 0
  const directFallback = failure.key === key ? failure.directFallback : false
  const current = candidates[failedCount]

  if (!current) {
    if (fallback !== undefined)
      return <>{fallback}</>
    const { fill, width, height, className, style } = props
    const sizeStyle: React.CSSProperties = fill
      ? {}
      : { width, aspectRatio: width && height ? `${width} / ${height}` : undefined, maxWidth: '100%', height: 'auto' }
    return (
      <ImagePlaceholder
        label={alt || undefined}
        className={cn(fill && 'absolute inset-0', className)}
        style={{ ...style, ...sizeStyle }}
      />
    )
  }

  const canOptimize = !props.unoptimized && shouldOptimize(current, optimizeHosts)
  const canFallbackDirect = canOptimize && !directFallback && typeof current === 'string' && (current.startsWith('https://') || current.startsWith('/api/v1/file/f/'))
  const renderSrc = canOptimize && !directFallback ? withInternalFileProxy(current) : current
  // Next.js 16 中 preload/priority 仅关闭默认懒加载并注入 preload link，不会自动给 <img> 补齐 loading="eager" 与 fetchpriority="high"；
  // 统一归一化为 preload（避免同时传 preload 与已弃用的 priority 报错），并显式补齐 eager + high 确保首屏 LCP 图立即高优拉取
  const isHighPriority = Boolean(preload || priority)
  const resolvedLoading = loading ?? (isHighPriority ? 'eager' : undefined)
  const resolvedFetchPriority = fetchPriority ?? (isHighPriority ? 'high' : undefined)
  const shouldPreload = isHighPriority && resolvedLoading !== 'lazy'

  return (
    <Image
      key={directFallback ? `${srcKey(current)}#direct` : srcKey(current)}
      src={renderSrc}
      alt={alt}
      preload={shouldPreload || undefined}
      loading={resolvedLoading}
      fetchPriority={resolvedFetchPriority}
      onError={(event) => {
        // 远程白名单图经 /_next/image 失败时（如上游返回非 image/* MIME），先静默降级为浏览器直连原图重试一次
        if (canFallbackDirect) {
          setFailure({ key, count: failedCount, directFallback: true })
          return
        }
        setFailure({ key, count: failedCount + 1, directFallback: false })
        onError?.(event)
      }}
      {...props}
      // 站外非白名单图片或降级重试时不经服务端代理，交给浏览器直接加载
      unoptimized={!canOptimize || directFallback}
    />
  )
}
