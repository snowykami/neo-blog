import type { VisitSourceCount } from '@/models/visit'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { SourceIcon, SourceName } from '@/components/console/visit-icons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { consolePath } from '@/utils/common/route'

// 访问来源：读者从哪里来，点击跳到访客记录并按来源筛选
export function SourcesCard({ sources, className }: { sources: VisitSourceCount[], className?: string }) {
  const t = useTranslations('Console.dashboard')
  const format = useFormatter()
  const total = sources.reduce((sum, item) => sum + item.count, 0)

  return (
    <Card className={cn('gap-4 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle>{t('sources_title')}</CardTitle>
        <CardDescription>{t('sources_description')}</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        {sources.length === 0
          ? (
              <Empty className="py-8">
                <EmptyDescription>{t('empty_sources')}</EmptyDescription>
              </Empty>
            )
          : (
              <ul className="grid gap-1">
                {sources.map((item) => {
                  const share = total > 0 ? item.count / total : 0
                  const params = new URLSearchParams({ source: item.source })
                  if (item.host)
                    params.set('source_host', item.host)
                  return (
                    <li key={`${item.source}-${item.host}`}>
                      <Link href={`${consolePath.visit}?${params}`} className="grid gap-1.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent">
                        <div className="flex items-center gap-2">
                          <SourceIcon source={item.source} className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">
                            <SourceName source={item.source} host={item.host} />
                          </span>
                          <span className="font-medium tabular-nums">{format.number(item.count)}</span>
                          <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                            {format.number(share, { style: 'percent', maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <Progress value={share * 100} className="h-1.5" aria-hidden="true" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
      </CardContent>
    </Card>
  )
}
