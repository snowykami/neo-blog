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
  children: React.ReactNode // 触发器，作为 AlertDialogTrigger 的子元素
  title: React.ReactNode
  description?: React.ReactNode
  content?: React.ReactNode // 自定义中间内容（例如表单或额外说明）
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: React.ComponentProps<typeof Button>['variant']
  disabled?: boolean
  closeOnConfirm?: boolean // 默认确认成功后关闭
  // 返回 Promise 时等待其完成：成功后关闭，失败则保持打开并提示错误
  onConfirm: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}

export function ConfirmDialog({
  children,
  title,
  description,
  content,
  confirmLabel = '',
  cancelLabel = '',
  confirmVariant = 'destructive',
  disabled = false,
  closeOnConfirm = true,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleOpenChange = (v: boolean) => {
    // 执行中不允许关闭，避免用户误以为操作已取消
    if (loading && !v)
      return
    setOpen(v)
    onOpenChange?.(v)
  }

  const handleConfirm = async () => {
    if (disabled || loading)
      return
    setLoading(true)
    try {
      await onConfirm()
    }
    catch (error) {
      toast.error(errorMessageT(error, operationT('operation_failed')))
      setLoading(false)
      return
    }
    setLoading(false)
    if (closeOnConfirm) {
      setOpen(false)
      onOpenChange?.(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
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
