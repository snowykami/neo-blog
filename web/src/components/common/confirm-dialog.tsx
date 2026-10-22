'use client'

import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'

interface ConfirmDialogProps {
  children?: React.ReactNode // 触发器，作为 AlertDialogTrigger 的子元素；受控模式下可省略
  title: React.ReactNode
  description?: React.ReactNode
  content?: React.ReactNode // 自定义中间内容（例如表单或额外说明）
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: React.ComponentProps<typeof Button>['variant']
  // 失败 Toast 的前缀，默认为「操作失败」
  errorText?: string
  disabled?: boolean
  closeOnConfirm?: boolean // 默认确认成功后关闭
  // 返回 Promise 时等待其完成：成功后关闭，失败则保持打开并提示错误
  onConfirm: () => void | Promise<void>
  // 受控模式：由下拉菜单等触发时，菜单关闭后弹窗仍需保留
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * 高风险、不可逆或有连带影响的操作确认（AlertDialog）；
 * 单个对象、影响可控的就地确认请使用 Popconfirm
 */
export function ConfirmDialog({
  children,
  title,
  description,
  content,
  confirmLabel = '',
  cancelLabel = '',
  confirmVariant = 'destructive',
  errorText,
  disabled = false,
  closeOnConfirm = true,
  onConfirm,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
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
    if (loading && !v)
      return
    changeOpen(v)
  }

  const handleConfirm = async () => {
    if (disabled || loading)
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
    if (closeOnConfirm)
      changeOpen(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            // 描述可能包含多段内容，用 div 承载避免 p 嵌套
            <AlertDialogDescription asChild>
              <div className="grid gap-2 text-sm text-muted-foreground">{description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {content}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel || operationT('cancel')}</AlertDialogCancel>
          {/* 不使用 AlertDialogAction：它点击后会立即关闭，无法等待异步结果 */}
          <Button
            onClick={handleConfirm}
            variant={confirmVariant}
            disabled={disabled || loading}
            aria-busy={loading}
            type="button"
          >
            {loading && <Loader2 className="animate-spin" />}
            {confirmLabel || operationT('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
