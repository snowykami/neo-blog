import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 侧栏卡片（参考 Fuwari 的 WidgetLayout，MIT License, saicaca/fuwari）：
 * 白卡无阴影，标题左侧 4×16px 主色短色条，内容区 mt-3
 */
export function SidebarCard({
  title,
  icon: Icon,
  action,
  className,
  contentClassName,
  children,
}: {
  title?: React.ReactNode
  icon?: LucideIcon
  /** 标题右侧的操作区（可选） */
  action?: React.ReactNode
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rounded-2xl bg-card p-4', className)}>
      {title && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="relative flex min-w-0 items-center gap-2 pl-4 text-lg font-bold text-foreground/90 before:absolute before:top-1/2 before:left-0 before:h-4 before:w-1 before:-translate-y-1/2 before:rounded-md before:bg-primary">
            {Icon && <Icon aria-hidden className="size-4.5 shrink-0 text-foreground/50" />}
            <span className="truncate">{title}</span>
          </h2>
          {action}
        </div>
      )}
      <div className={cn(title && 'mt-3', contentClassName)}>{children}</div>
    </section>
  )
}
