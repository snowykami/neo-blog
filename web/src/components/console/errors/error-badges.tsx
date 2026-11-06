'use client'

import type { ErrorIssue } from '@/models/error-report'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// 级别颜色：致命（含页面崩溃）为红色，错误为橙色，警告（含后台被回收）为琥珀色，其余为灰色
const LEVEL_STYLES: Record<string, string> = {
  fatal: 'bg-red-600',
  error: 'bg-orange-500',
  warning: 'bg-amber-500',
}

export function LevelDot({ level, className }: { level: string, className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', LEVEL_STYLES[level] ?? 'bg-muted-foreground', className)} aria-hidden="true" />
}

/** 来源与类型（错误之外的类型才显示） */
export function IssueBadges({ issue }: { issue: Pick<ErrorIssue, 'source' | 'kind' | 'status'> }) {
  const t = useTranslations('Console.errors')
  return (
    <>
      <Badge variant="secondary" className="px-1.5 text-[11px]">{t(`source_${issue.source}`)}</Badge>
      {issue.kind !== 'error' && (
        <Badge variant={issue.kind === 'crash' ? 'destructive' : 'outline'} className="px-1.5 text-[11px]">{t(`kind_${issue.kind}`)}</Badge>
      )}
      {issue.status !== 'unresolved' && <Badge variant="outline" className="px-1.5 text-[11px]">{t(`status_${issue.status}`)}</Badge>}
    </>
  )
}
