import type { PostNeighborItem, PostNeighbors } from '@/models/post'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { stripInlineMarkdown } from '@/utils/common/inline-markdown'
import { getPostUrl } from '@/utils/common/route'

function neighborSummary(item: PostNeighborItem): string {
  return stripInlineMarkdown(item.description) || item.excerpt || ''
}

export async function PostContinuation({ neighbors }: { neighbors: PostNeighbors }) {
  const { prev, next, related } = neighbors
  const hasAdjacent = Boolean(prev || next)
  const hasRelated = related && related.length > 0

  if (!hasAdjacent && !hasRelated)
    return null

  const [t, format] = await Promise.all([
    getTranslations('Common'),
    getFormatter(),
  ])

  return (
    <div className="flex flex-col gap-4">
      {hasAdjacent && (
        <nav
          aria-label={`${t('prev_post')} / ${t('next_post')}`}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {prev && (
            <Link
              href={getPostUrl({ post: prev })}
              className="group flex flex-col justify-between gap-2 rounded-2xl bg-card px-5 py-4 transition-colors hover:bg-accent/50"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <ChevronLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
                {t('prev_post')}
              </span>
              <span className="line-clamp-2 text-sm font-semibold text-foreground/90 transition-colors group-hover:text-primary md:text-base">
                {prev.title || t('untitled')}
              </span>
            </Link>
          )}
          {next && (
            <Link
              href={getPostUrl({ post: next })}
              className={cn(
                'group flex flex-col justify-between gap-2 rounded-2xl bg-card px-5 py-4 text-right transition-colors hover:bg-accent/50',
                !prev && 'sm:col-start-2',
              )}
            >
              <span className="flex items-center justify-end gap-1 text-xs font-medium text-muted-foreground">
                {t('next_post')}
                <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="line-clamp-2 text-sm font-semibold text-foreground/90 transition-colors group-hover:text-primary md:text-base">
                {next.title || t('untitled')}
              </span>
            </Link>
          )}
        </nav>
      )}

      {hasRelated && (
        <section className="rounded-2xl bg-card px-6 py-6 md:px-9">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-base font-semibold text-foreground/90">{t('related_posts')}</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {related.map((item) => {
              const summary = neighborSummary(item)
              return (
                <Link
                  key={item.id}
                  href={getPostUrl({ post: item })}
                  className="group flex gap-3.5 rounded-xl border border-border/50 bg-background/40 p-3.5 transition-colors hover:border-primary/30 hover:bg-accent/40"
                >
                  {item.cover && (
                    <div className="relative size-18 shrink-0 overflow-hidden rounded-lg bg-muted">
                      <SafeImage
                        src={item.cover}
                        alt=""
                        fill
                        sizes="72px"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
                    <div className="space-y-1">
                      <h3 className="line-clamp-2 text-sm font-medium text-foreground/90 transition-colors group-hover:text-primary">
                        {item.title || t('untitled')}
                      </h3>
                      {summary && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {summary}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {item.category?.name && (
                        <Badge variant="secondary" className="h-5 max-w-28 truncate px-1.5 text-[11px] font-normal">
                          {item.category.name}
                        </Badge>
                      )}
                      {item.createdAt && (
                        <time dateTime={item.createdAt} className="tabular-nums">
                          {format.dateTime(new Date(item.createdAt), { dateStyle: 'medium' })}
                        </time>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
