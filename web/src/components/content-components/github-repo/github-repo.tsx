'use client'

import type { GithubRepoProps } from './schema'
import { GitForkIcon, ScaleIcon, StarIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { FaGithub } from 'react-icons/fa6'
import { getGithubRepo } from '@/api/github'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useCachedRequest } from '../use-cached-request'

/** GitHub 仓库卡：头像、仓库名、简介、语言、Star / Fork 数与许可证，整卡链接到仓库 */
export default function GithubRepoCard({ repo }: GithubRepoProps) {
  const t = useTranslations('ContentComponents.githubRepo')
  const format = useFormatter()
  const [owner, name] = repo.split('/')
  const state = useCachedRequest(`github:${repo.toLowerCase()}`, () => getGithubRepo(owner, name))
  const data = state.status === 'success' ? state.data : null
  const compact = (value: number) => format.number(value, { notation: 'compact', maximumFractionDigits: 1 })

  return (
    <a
      href={data?.htmlUrl || `https://github.com/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border bg-card p-4 text-card-foreground no-underline transition-colors hover:border-primary/40"
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
          <Skeleton className="h-4 w-1/3" />
        </div>
      )}
      {state.status === 'error' && <p className="mt-2 text-sm text-muted-foreground">{t('load_failed')}</p>}
      {data && (
        <>
          {data.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{data.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
              <span className="inline-flex items-center gap-1">
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
