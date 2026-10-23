'use client'

import type { AlertContentProps } from './alert.content'
import { CircleAlertIcon, InfoIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** 文章中的 Alert：标题 + 多行说明 */
export default function AlertContent({ variant, title, description }: AlertContentProps) {
  const Icon = variant === 'destructive' ? CircleAlertIcon : InfoIcon
  return (
    <Alert role="note" variant={variant} className="rounded-xl">
      <Icon />
      <AlertTitle className="line-clamp-none">{title}</AlertTitle>
      {description && <AlertDescription className="block whitespace-pre-line">{description}</AlertDescription>}
    </Alert>
  )
}
