import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

/** 图标块 + 文本的元信息项；label 仅供读屏 */
export function PostMetaItem({
  icon: Icon,
  label,
  compact = false,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  /** 列表页紧凑模式：使用轻量行内图标替代色块底，降低列表行视觉噪点 */
  compact?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      {compact
        ? <Icon aria-hidden className="mr-1.5 size-3.5 shrink-0 text-muted-foreground/80" />
        : (
            <span aria-hidden className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <Icon className="size-4" />
            </span>
          )}
      <span className="sr-only">{label}</span>
      <div className={cn('min-w-0 font-medium text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{children}</div>
    </div>
  )
}
