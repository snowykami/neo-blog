'use client'

import * as React from 'react'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatShortcut } from './editor-commands'

// 工具栏按钮的基础样式：工具栏、气泡菜单、图片浮动工具栏共用
export const toolbarButtonClass = cn(
  'relative inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5',
  'text-[13.5px] whitespace-nowrap text-foreground/75 transition-colors outline-none',
  'hover:bg-accent hover:text-foreground active:bg-accent/80',
  'focus-visible:ring-2 focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:opacity-40',
  'aria-pressed:bg-primary/10 aria-pressed:text-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-[18px]',
)

/** 带提示（名称 + 快捷键）的提示包装 */
export function EditorTooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement
}) {
  return (
    <Tooltip delayDuration={450}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && <Kbd>{formatShortcut(shortcut)}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export interface EditorToolbarButtonProps extends React.ComponentProps<'button'> {
  label: string
  shortcut?: string
  // 切换类按钮的激活状态；undefined 表示非切换按钮
  active?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  // 隐藏提示（例如作为下拉菜单触发器时由外层负责）
  noTooltip?: boolean
}

/**
 * 工具栏按钮：mousedown 时阻止默认行为，避免点击按钮导致编辑器失焦、选区丢失
 */
export function EditorToolbarButton({
  label,
  shortcut,
  active,
  tooltipSide,
  noTooltip,
  className,
  children,
  onMouseDown,
  ref,
  ...props
}: EditorToolbarButtonProps) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(toolbarButtonClass, className)}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        event.preventDefault()
      }}
      {...props}
    >
      {children}
    </button>
  )
  if (noTooltip)
    return button
  return (
    <EditorTooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </EditorTooltip>
  )
}

export function EditorToolbarSeparator({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('mx-1.5 h-[18px] w-px shrink-0 bg-border', className)} />
}
