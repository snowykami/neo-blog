import type { DashboardMetric, DashboardSummary } from '@/models/dashboard'
import type { IconType } from '@/types/icon'
import { Eye, Heart, MessageCircle, Minus, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'

type SummaryKey = 'pv' | 'uv' | 'comments' | 'likes'

// 博主最常看的四个数：来了多少人、看了多少次、留下了多少评论和点赞
const STAT_ITEMS: { key: SummaryKey, icon: IconType, url: string }[] = [
  { key: 'pv', icon: Eye, url: consolePath.visit },
  { key: 'uv', icon: Users, url: consolePath.visit },
  { key: 'comments', icon: MessageCircle, url: consolePath.comment },
  { key: 'likes', icon: Heart, url: `${consolePath.visit}?action=interaction` },
]

export function StatCards({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {STAT_ITEMS.map(item => (
        <Link key={item.key} href={item.url} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <Card className="h-full gap-2 py-4 transition-colors hover:border-primary/40">
            <CardHeader className="px-4">
              <CardDescription className="flex items-center gap-1.5">
                <item.icon className="size-4" aria-hidden="true" />
                {t(`metric_${item.key}`)}
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums sm:text-3xl">
                {format.number(summary[item.key].current)}
              </CardTitle>
            </CardHeader>
            {/* 环比放在数值下方，窄屏两列时也不会挤压标题 */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-muted-foreground tabular-nums">
              <DeltaBadge metric={summary[item.key]} />
              <span>{t('previous_value', { value: format.number(summary[item.key].previous) })}</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}

// 环比：上期为 0 时无法计算百分比，有数据显示“新增”，都为 0 显示“持平”
export function DeltaBadge({ metric, className }: { metric: DashboardMetric, className?: string }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const { current, previous } = metric
  const diff = current - previous
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus
  let text: string
  if (diff === 0)
    text = t('delta_flat')
  else if (previous === 0)
    text = t('delta_new')
  else
    text = format.number(diff / previous, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'always' })
  return (
    <Badge
      variant="outline"
      className={cn(
        'tabular-nums',
        diff > 0 && 'border-primary/30 bg-primary/10 text-primary',
        diff < 0 && 'border-destructive/30 bg-destructive/10 text-destructive',
        diff === 0 && 'text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {text}
    </Badge>
  )
}
