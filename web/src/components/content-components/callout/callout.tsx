'use client'

import type { LucideIcon } from 'lucide-react'
import type { CalloutProps } from './schema'
import { InfoIcon, LightbulbIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

const STYLES: Record<CalloutProps['type'], { icon: LucideIcon, className: string }> = {
  info: { icon: InfoIcon, className: 'border-sky-500/30 bg-sky-500/[.07] [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400' },
  warning: { icon: TriangleAlertIcon, className: 'border-amber-500/35 bg-amber-500/[.08] [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400' },
  tip: { icon: LightbulbIcon, className: 'border-emerald-500/30 bg-emerald-500/[.07] [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400' },
}

/** 提示框：信息 / 警告 / 技巧，未填写标题时显示类型名称 */
export default function Callout({ type, title, content }: CalloutProps) {
  const t = useTranslations('ContentComponents.callout.options.type')
  const { icon: Icon, className } = STYLES[type]
  return (
    // 正文中的静态提示，不作为需要立即播报的 alert
    <Alert role="note" className={cn('rounded-xl px-4 py-3.5', className)}>
      <Icon />
      <AlertTitle className="line-clamp-none text-foreground">{title || t(type)}</AlertTitle>
      <AlertDescription className="block leading-relaxed whitespace-pre-line text-foreground/80">{content}</AlertDescription>
    </Alert>
  )
}
