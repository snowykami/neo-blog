'use client'

import type { ArchiveGroup } from './archive'
import { useTranslations } from 'next-intl'
import { useQueryState } from 'nuqs'
import { Suspense, useLayoutEffect, useMemo, useState } from 'react'
import { HoverPrefetchLink } from '@/components/common/hover-prefetch-link'
import { SectionTitle } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/i18n/navigation'
import { mainPath } from '@/utils/common/route'

function ArchiveQueryBridge({
  onSync,
}: {
  onSync: (filter: { label: string, category: string }) => void
}) {
  const [label] = useQueryState('label')
  const [category] = useQueryState('category')

  useLayoutEffect(() => {
    onSync({ label: label ?? '', category: category ?? '' })
  }, [category, label, onSync])

  return null
}

export function ArchiveTimeline({
  groups,
  archiveTitle,
}: {
  groups: ArchiveGroup[]
  archiveTitle: string
}) {
  const t = useTranslations('Archive')
  const [filter, setFilter] = useState<{ label: string, category: string }>({ label: '', category: '' })

  const filteredGroups = useMemo(() => {
    const labelFilter = filter.label.trim()
    const categoryFilter = filter.category.trim()
    if (!labelFilter && !categoryFilter)
      return groups

    const next: ArchiveGroup[] = []
    for (const group of groups) {
      const matched = group.posts.filter((post) => {
        if (labelFilter && !post.labelSlugs.includes(labelFilter) && !post.labels.includes(labelFilter))
          return false
        if (categoryFilter && post.categorySlug !== categoryFilter && post.categoryName !== categoryFilter)
          return false
        return true
      })
      if (matched.length > 0)
        next.push({ year: group.year, posts: matched })
    }
    return next
  }, [filter.category, filter.label, groups])

  const totalPosts = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + group.posts.length, 0),
    [filteredGroups],
  )

  const filterDisplayName = useMemo(() => {
    if (filter.label) {
      for (const g of groups) {
        for (const p of g.posts) {
          const idx = p.labelSlugs.indexOf(filter.label)
          if (idx >= 0 && p.labels[idx])
            return p.labels[idx]
        }
      }
      return filter.label
    }
    if (filter.category) {
      for (const g of groups) {
        for (const p of g.posts) {
          if (p.categorySlug === filter.category && p.categoryName)
            return p.categoryName
        }
      }
      return filter.category
    }
    return ''
  }, [filter.category, filter.label, groups])

  const filterText = filter.label
    ? t('filter_label', { name: filterDisplayName })
    : filter.category
      ? t('filter_category', { name: filterDisplayName })
      : ''

  return (
    <>
      <Suspense fallback={null}>
        <ArchiveQueryBridge
          onSync={next => setFilter(prev => (prev.label === next.label && prev.category === next.category ? prev : next))}
        />
      </Suspense>
      <SectionTitle as="h1" className="mx-4 text-xl md:mx-2 md:text-2xl">
        {archiveTitle}
        {totalPosts > 0 && <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{totalPosts}</span>}
      </SectionTitle>
      {/* 归档正文 */}
      <div className="surface-card rounded-2xl bg-card px-4 py-6 md:px-8">
        {filterText && (
          <div className="mb-2 flex items-center gap-3 px-2 text-sm">
            <Badge variant="secondary">{filterText}</Badge>
            <Link href={mainPath.archive} prefetch={false} className="rounded-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('clear_filter')}
            </Link>
          </div>
        )}
        {filteredGroups.map(group => (
          <div key={group.year}>
            {/* 年份行：年份、空心圆点、文章数 */}
            <div className="flex h-15 w-full flex-row items-center">
              <div className="w-16 shrink-0 text-right text-2xl font-bold text-foreground/75 tabular-nums md:w-20">
                {group.year}
              </div>
              <div className="w-10 shrink-0 md:w-12">
                <div className="relative z-10 mx-auto size-3 rounded-full outline-3 -outline-offset-2 outline-primary" />
              </div>
              <div className="min-w-0 flex-1 text-left text-muted-foreground">
                {t('posts_count', { count: group.posts.length })}
              </div>
            </div>

            {group.posts.map(post => (
              <HoverPrefetchLink
                key={post.id}
                href={post.url}
                aria-label={post.title}
                className="group block h-10 w-full rounded-lg transition-colors duration-150 hover:bg-primary/10 active:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex h-full flex-row items-center justify-start">
                  {/* 日期 */}
                  <div className="w-16 shrink-0 text-right text-sm text-muted-foreground tabular-nums md:w-20">
                    {post.date}
                  </div>
                  {/* 圆点与虚线时间轴，圆点外描边与背景同色以遮住虚线 */}
                  <div className="archive-dash-line relative flex h-full w-10 shrink-0 items-center md:w-12">
                    <div className="relative z-10 mx-auto h-1 w-1 rounded bg-foreground/40 outline-4 outline-card transition-[height,background-color,outline-color] duration-150 group-hover:h-5 group-hover:bg-primary group-hover:outline-[color-mix(in_oklab,var(--primary)_10%,var(--card))]" />
                  </div>
                  {/* 标题 */}
                  <div className="min-w-0 flex-1 truncate pr-2 text-left font-bold text-foreground/75 transition-[color,transform] duration-150 group-hover:translate-x-1 group-hover:text-primary md:pr-6">
                    {post.title}
                  </div>
                  {/* 标签 */}
                  <div className="hidden w-[18%] shrink-0 truncate text-left text-sm text-muted-foreground md:block">
                    {post.labels.map(label => `#${label}`).join(' ')}
                  </div>
                </div>
              </HoverPrefetchLink>
            ))}
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <p className="py-10 text-center text-muted-foreground">{t('empty')}</p>
        )}
      </div>
    </>
  )
}
