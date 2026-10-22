'use client'

import { CircleAlertIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'

interface PopconfirmProps {
  // 触发器；anchorOnly 时仅作为气泡的定位锚点
  children: React.ReactElement
  title: React.ReactNode
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  // 失败 Toast 的前缀，默认为「操作失败」
  errorText?: string
  destructive?: boolean
  disabled?: boolean
  // 返回 Promise 时等待其完成：成功后关闭，失败则保持打开并提示错误
  onConfirm: () => void | Promise<void>
  // 受控模式，例如由下拉菜单项打开
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // 为 true 时 children 不响应点击，只用于定位，需配合受控 open 使用；
  // 注意 children 内若有其他 Popover 的触发器，需让该 Popover 根节点位于 children 内部，避免取错上下文
  anchorOnly?: boolean
  side?: React.ComponentProps<typeof PopoverContent>['side']
  align?: React.ComponentProps<typeof PopoverContent>['align']
}

/**
 * 就地的轻量二次确认气泡，适用于单个对象、影响可控的操作；
 * 高风险或有连带影响的操作请使用 ConfirmDialog（AlertDialog）
 */
export function Popconfirm({
  children,
  title,
  description,
  confirmText,
  cancelText,
  errorText,
  destructive = false,
  disabled = false,
  onConfirm,
  open: openProp,
  onOpenChange,
  anchorOnly = false,
  side = 'bottom',
  align = 'end',
}: PopconfirmProps) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const titleId = useId()
  const descriptionId = useId()
  const anchorRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [innerOpen, setInnerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const open = openProp ?? innerOpen

  const changeOpen = (v: boolean) => {
    if (openProp === undefined)
      setInnerOpen(v)
    onOpenChange?.(v)
  }

  const handleOpenChange = (v: boolean) => {
    // 执行中不允许关闭，避免用户误以为操作已取消
    if ((loading && !v) || (disabled && v))
      return
    changeOpen(v)
  }

  const handleConfirm = async () => {
    if (loading)
      return
    setLoading(true)
    try {
      await onConfirm()
    }
    catch (error) {
      const prefix = errorText || operationT('operation_failed')
      const reason = errorMessageT(error)
      toast.error(reason ? `${prefix}: ${reason}` : prefix)
      setLoading(false)
      return
    }
    setLoading(false)
    changeOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {anchorOnly
        ? <PopoverAnchor asChild ref={anchorRef as React.Ref<HTMLDivElement>}>{children}</PopoverAnchor>
        : <PopoverTrigger asChild>{children}</PopoverTrigger>}
      <PopoverContent
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        side={side}
        align={align}
        collisionPadding={8}
        className="grid w-72 max-w-[calc(100vw-1rem)] gap-3 p-3"
        // 默认聚焦「取消」，防止误按回车直接确认
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
        // 锚点模式下 Radix 找不到触发器，关闭后手动把焦点还给锚点（锚点不可聚焦时取其中第一个可聚焦元素）
        onCloseAutoFocus={anchorOnly
          ? (e) => {
              e.preventDefault()
              const anchor = anchorRef.current
              const target = anchor && anchor.tabIndex < 0
                ? anchor.querySelector<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')
                : anchor
              target?.focus()
            }
          : undefined}
        // 焦点回到锚点（例如下拉菜单关闭时）不视为离开
        onFocusOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node))
            e.preventDefault()
        }}
      >
        <div className="flex gap-2.5">
          <CircleAlertIcon
            aria-hidden="true"
            className={cn('mt-0.5 size-4 shrink-0', destructive ? 'text-destructive' : 'text-amber-500')}
          />
          <div className="grid min-w-0 gap-1">
            <p id={titleId} className="text-sm font-medium break-words">{title}</p>
            {description && <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} type="button" size="sm" variant="outline" disabled={loading} onClick={() => changeOpen(false)}>
            {cancelText || operationT('cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            disabled={loading}
            aria-busy={loading}
            onClick={handleConfirm}
          >
            {loading && <Spinner />}
            {confirmText || operationT('confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
