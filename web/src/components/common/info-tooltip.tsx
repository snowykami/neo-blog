'use client'

import { InfoIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface InfoTooltipProps {
  content: React.ReactNode
  side?: React.ComponentProps<typeof TooltipContent>['side']
  label?: string // 图标按钮的无障碍名称，默认「更多说明」
  className?: string
}

/**
 * 说明气泡：一个 info 图标，悬停 / 键盘聚焦时显示说明，触屏设备点按显示、点击别处关闭
 * 用于表单项、设置项等的补充说明，替代常驻在字段下方的灰色说明文字
 */
export function InfoTooltip({ content, side = 'top', label, className }: InfoTooltipProps) {
  const t = useTranslations('Common')
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ?? t('more_info')}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          // Radix Tooltip 不响应触摸悬停：按下会先触发关闭，这里在点击时重新打开，保证点按也能看到说明
          onClick={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          <InfoIcon aria-hidden className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={4} className="max-w-72 text-left leading-relaxed text-pretty">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 标签 + 说明气泡：把 info 图标放在标签右侧
 * 图标不能放进 <label> 内部，否则点击图标会聚焦输入框，因此用外层容器并排
 */
export function LabelWithInfo({ children, info, className }: { children: React.ReactNode, info?: React.ReactNode, className?: string }) {
  if (!info)
    return <>{children}</>
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {children}
      <InfoTooltip content={info} />
    </div>
  )
}
