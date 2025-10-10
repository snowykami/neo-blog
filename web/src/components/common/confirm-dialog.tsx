'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface ConfirmDialogProps {
  children: React.ReactNode // 触发器，作为 DialogTrigger 的子元素
  title: React.ReactNode
  description?: React.ReactNode
  content?: React.ReactNode // 自定义中间内容（例如表单或额外说明）
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'ghost' | string
  disabled?: boolean
  closeOnConfirm?: boolean // 默认确认成功后关闭
  onConfirm: () => void
  onOpenChange?: (open: boolean) => void
}

export function ConfirmDialog({
  children,
  title,
  description,
  content,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  disabled = false,
  closeOnConfirm = true,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    onOpenChange?.(v)
  }

  const handleConfirm = async () => {
    if (disabled)
      return
    try {
      setLoading(true)
      await onConfirm()
      if (closeOnConfirm)
        handleOpenChange(false)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {content}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{cancelLabel}</Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            variant={confirmVariant as unknown as 'default'}
            disabled={disabled || loading}
            type="button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
