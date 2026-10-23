'use client'

import type { GithubRepoProps } from './schema'
import { GitForkIcon, ScaleIcon, StarIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { FaGithub } from 'react-icons/fa6'
import { getGithubRepo } from '@/api/github'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCachedRequest } from '../use-cached-request'
import { useComponentHeight } from '../use-component-height'

/**
 * GitHub 仓库卡：头像、仓库名、简介、语言、Star / Fork 数与许可证，整卡链接到仓库
 * 高度 1 单位时只保留仓库名与统计；2 单位时简介最多四行、统计固定在底部；窄卡片收起许可证
 */
export default function GithubRepoCard({ repo }: GithubRepoProps) {
  const t = useTranslations('ContentComponents.githubRepo')
  const format = useFormatter()
  const [owner, name] = repo.split('/')
  const state = useCachedRequest(`github:${repo.toLowerCase()}`, () => getGithubRepo(owner, name))
  const data = state.status === 'success' ? state.data : null
  const compact = (value: number) => format.number(value, { notation: 'compact', maximumFractionDigits: 1 })
  const height = useComponentHeight()

  return (
    <a
      href={data?.htmlUrl || `https://github.com/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-xl border bg-card p-4 text-card-foreground no-underline transition-colors hover:border-primary/40',
        height === 1 && 'justify-center',
      )}
    >
      <div className="flex items-center gap-2.5">
        <FaGithub className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-semibold text-foreground group-hover:text-primary">
          {data ? data.fullName : repo}
        </span>
        {data?.archived && <Badge variant="secondary" className="shrink-0 rounded-md">{t('archived')}</Badge>}
        {data?.ownerAvatar && (
          <SafeImage src={data.ownerAvatar} alt="" width={24} height={24} className="ml-auto size-6 shrink-0 rounded-full" fallback={null} />
        )}
      </div>

      {state.status === 'loading' && (
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-4 w-4/5" />
          {height !== 1 && <Skeleton className="h-4 w-1/3" />}
        </div>
      )}
      {state.status === 'error' && <p className="mt-2 text-sm text-muted-foreground">{t('load_failed')}</p>}
      {data && (
        <>
          {data.description && height !== 1 && (
            <p className={cn('mt-2 text-sm text-muted-foreground', height === 2 ? 'line-clamp-4' : 'line-clamp-2')}>{data.description}</p>
          )}
          <div
            className={cn(
              'flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground',
              // 1 单位时统计只占一行，放不下的项被裁掉；固定高度时统计贴底
              height === 1 ? 'mt-2.5 flex-nowrap overflow-hidden' : 'flex-wrap',
              height === 2 ? 'mt-auto pt-3' : height == null && 'mt-3',
            )}
          >
            {data.language && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-full bg-primary" />
                {data.language}
              </span>
            )}
            <span className="inline-flex items-center gap-1" title={t('stars')}>
              <StarIcon className="size-3.5" aria-hidden />
              <span className="sr-only">{t('stars')}</span>
              {compact(data.stars)}
            </span>
            <span className="inline-flex items-center gap-1" title={t('forks')}>
              <GitForkIcon className="size-3.5" aria-hidden />
              <span className="sr-only">{t('forks')}</span>
              {compact(data.forks)}
            </span>
            {data.license && (
              <span className="inline-flex items-center gap-1 @max-2xs:hidden">
                <ScaleIcon className="size-3.5" aria-hidden />
                {data.license}
              </span>
            )}
          </div>
        </>
      )}
    </a>
  )
}
