import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

/** 图标块 + 文本的元信息项；label 仅供读屏 */
export function PostMetaItem({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center', className)}>
      <span aria-hidden className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <Icon className="size-4" />
      </span>
      <span className="sr-only">{label}</span>
      <div className="min-w-0 text-sm font-medium text-foreground/50">{children}</div>
    </div>
  )
}
