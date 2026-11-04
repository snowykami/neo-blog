'use client'

import type { AIAgentStats } from '@/models/ai-agent'
import { Activity, Bot, Coins, Heart, MessageCircle, Power, Settings2, TriangleAlert, Zap } from 'lucide-react'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'
import { useAIAgentT, useCompactNumber } from './shared'

// 全站开关与各项上限在「全局设置 → AI」中配置，这里只展示并给出跳转
export const AI_SETTINGS_URL = `${consolePath.global}?tab=ai`

function StatCard({ icon: Icon, label, value, limit, hint, tone }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  limit?: { used: number, max: number } // max 为 0 时不限，不显示进度条
  hint?: React.ReactNode
  tone?: 'ok' | 'warn' | 'muted'
}) {
  const ratio = limit && limit.max > 0 ? Math.min(100, (limit.used / limit.max) * 100) : null
  return (
    <Card className="gap-1.5 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className={cn('text-2xl font-semibold tabular-nums', tone === 'warn' && 'text-destructive', tone === 'muted' && 'text-muted-foreground')}>{value}</div>
      {ratio !== null && <Progress value={ratio} className={cn('h-1.5', ratio >= 90 && '[&>[data-slot=progress-indicator]]:bg-destructive')} />}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export function AIAgentStatsCards({ stats }: { stats: AIAgentStats | null }) {
  const t = useAIAgentT()
  const compact = useCompactNumber()
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    )
  }
  const usage = (used: number, max: number, format: (n: number) => string | number = n => n) =>
    max > 0 ? `${format(used)} / ${format(max)}` : `${format(used)}`
  return (
    <div className="grid gap-4">
      {(!stats.enabled || !stats.aiConfigured || !stats.runnerConfigured) && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{!stats.enabled ? t('stats.disabled_title') : t('stats.not_ready_title')}</AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {!stats.enabled && <li>{t('stats.disabled_hint')}</li>}
              {!stats.aiConfigured && <li>{t('stats.ai_not_configured')}</li>}
              {!stats.runnerConfigured && <li>{t('stats.runner_not_configured')}</li>}
            </ul>
            <Button size="sm" variant="outline" className="mt-2" asChild>
              <Link href={AI_SETTINGS_URL}>
                <Settings2 />
                {t('stats.settings_link')}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Bot}
          label={t('stats.agents')}
          value={stats.total}
          hint={t('stats.agents_hint', { expert: stats.expert, ambient: stats.ambient, groups: stats.groups, paused: stats.paused })}
        />
        <StatCard
          icon={MessageCircle}
          label={t('stats.today_comments')}
          value={usage(stats.todayComments, stats.commentsPerDayLimit)}
          limit={{ used: stats.todayComments, max: stats.commentsPerDayLimit }}
          hint={stats.commentsPerDayLimit > 0 ? t('stats.daily_limit') : t('stats.unlimited')}
        />
        <StatCard
          icon={Heart}
          label={t('stats.today_likes')}
          value={usage(stats.todayLikes, stats.likesPerDayLimit)}
          limit={{ used: stats.todayLikes, max: stats.likesPerDayLimit }}
          hint={stats.likesPerDayLimit > 0 ? t('stats.daily_limit') : t('stats.unlimited')}
        />
        <StatCard
          icon={Zap}
          label={t('stats.hour_llm_calls')}
          value={usage(stats.hourLlmCalls, stats.llmCallsPerHour)}
          limit={{ used: stats.hourLlmCalls, max: stats.llmCallsPerHour }}
          hint={stats.llmCallsPerHour > 0 ? t('stats.hourly_limit') : t('stats.unlimited')}
        />
        <StatCard
          icon={Coins}
          label={t('stats.month_tokens')}
          value={usage(stats.monthTokens, stats.monthlyTokenBudget, compact)}
          limit={{ used: stats.monthTokens, max: stats.monthlyTokenBudget }}
          hint={stats.monthlyTokenBudget > 0 ? t('stats.monthly_budget') : t('stats.unlimited')}
        />
        <Card className="gap-1.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Activity className="size-3.5" />
              {t('stats.runner')}
            </span>
            <Link href={AI_SETTINGS_URL} className="flex items-center gap-1 hover:text-primary" title={t('stats.settings_link')}>
              <Settings2 className="size-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={cn('size-2 rounded-full', stats.runnerOnline ? 'bg-emerald-500' : 'bg-muted-foreground')} aria-hidden="true" />
            {stats.runnerOnline ? t('stats.runner_online') : t('stats.runner_offline')}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Power className={cn('size-3.5', stats.enabled ? 'text-emerald-500' : 'text-muted-foreground')} />
            {stats.enabled ? t('stats.enabled_on') : t('stats.enabled_off')}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{t('stats.queued_runs', { count: stats.queuedRuns })}</div>
        </Card>
      </div>
    </div>
  )
}
