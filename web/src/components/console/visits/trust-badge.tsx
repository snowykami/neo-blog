import type { LucideIcon } from 'lucide-react'
import type { VisitSeverity, VisitTrust } from '@/models/visit'
import { BotIcon, CircleHelpIcon, InfoIcon, RouteIcon, ShieldCheckIcon, ShieldXIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// 可信度与严重度的配色：浅色底 + 彩色图标 + 文字，不单靠颜色区分
export const TRUST_STYLES: Record<VisitTrust, { icon: LucideIcon, badge: string, fill: string }> = {
  trusted: { icon: ShieldCheckIcon, badge: 'border-emerald-500/40 bg-emerald-500/10 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400', fill: 'bg-emerald-500' },
  proxy: { icon: RouteIcon, badge: 'border-amber-500/50 bg-amber-500/10 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400', fill: 'bg-amber-400' },
  spoofed: { icon: ShieldXIcon, badge: 'border-orange-500/45 bg-orange-500/10 [&>svg]:text-orange-600 dark:[&>svg]:text-orange-400', fill: 'bg-orange-500' },
  bot: { icon: BotIcon, badge: 'border-red-500/45 bg-red-500/10 [&>svg]:text-red-600 dark:[&>svg]:text-red-400', fill: 'bg-red-600' },
  unknown: { icon: CircleHelpIcon, badge: 'bg-muted [&>svg]:text-muted-foreground', fill: 'bg-muted-foreground/40' },
}

export const SEVERITY_STYLES: Record<VisitSeverity, string> = {
  high: 'border-red-500/45 bg-red-500/10 [&>svg]:text-red-600 dark:[&>svg]:text-red-400',
  medium: 'border-orange-500/45 bg-orange-500/10 [&>svg]:text-orange-600 dark:[&>svg]:text-orange-400',
  low: 'border-amber-500/50 bg-amber-500/10 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
  info: 'border-sky-500/40 bg-sky-500/10 [&>svg]:text-sky-600 dark:[&>svg]:text-sky-400',
}

export function TrustBadge({ trust, className }: { trust: VisitTrust, className?: string }) {
  const t = useTranslations('Console.visits.trust')
  // 旧版本写入的结论（如 human）不在当前取值里：按「信号不足」显示，不让整页进入错误边界
  const known: VisitTrust = trust in TRUST_STYLES ? trust : 'unknown'
  const { icon: Icon, badge } = TRUST_STYLES[known]
  return (
    <Badge variant="outline" className={cn(badge, className)}>
      <Icon aria-hidden="true" />
      {t(`verdicts.${known}.label`)}
    </Badge>
  )
}

// 命中的规则：显示规则名，颜色与图标表示严重度
export function RuleFlagBadge({ id, severity, title }: { id: string, severity: VisitSeverity, title?: string }) {
  const t = useTranslations('Console.visits.trust')
  const Icon = severity === 'info' ? InfoIcon : TriangleAlertIcon
  return (
    <Badge variant="outline" className={SEVERITY_STYLES[severity]} title={title ?? t(`severity.${severity}`)}>
      <Icon aria-hidden="true" />
      {t(`rules.${id}.name`)}
    </Badge>
  )
}

export function SeverityBadge({ severity }: { severity: VisitSeverity }) {
  const t = useTranslations('Console.visits.trust')
  const Icon = severity === 'info' ? InfoIcon : TriangleAlertIcon
  return (
    <Badge variant="outline" className={SEVERITY_STYLES[severity]}>
      <Icon aria-hidden="true" />
      {t(`severity.${severity}`)}
    </Badge>
  )
}
