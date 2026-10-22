'use client'

import type { ImageProps } from 'next/image'
import { ImageOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'
import { cn } from '@/lib/utils'

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

// next.config 只允许优化 https 外链，http 外链不经服务端代理，交给浏览器直接加载
function isHttpUrl(src: ImageProps['src']) {
  return typeof src === 'string' && src.startsWith('http://')
}

/**
 * 带兜底的图片：原图 → 备用图 → 占位块，每一级只尝试一次；src 变化后重新从原图开始
 */
export function SafeImage({ src, fallbackSrc, fallback, alt = '', onError, ...props }: SafeImageProps) {
  // 去掉空值与重复地址，避免同一个失效地址被重复尝试
  const candidates = [src, fallbackSrc].filter((item, index, list): item is ImageProps['src'] =>
    !!item && list.findIndex(other => srcKey(other) === srcKey(item)) === index)
  const key = srcKey(src)
  // 记录失败次数时一并记录对应的原图，原图变化时自动重置
  const [failure, setFailure] = useState({ key, count: 0 })
  const failedCount = failure.key === key ? failure.count : 0
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

  return (
    <Image
      key={srcKey(current)}
      src={current}
      alt={alt}
      onError={(event) => {
        setFailure({ key, count: failedCount + 1 })
        onError?.(event)
      }}
      {...props}
      unoptimized={props.unoptimized || isHttpUrl(current)}
    />
  )
}
