'use client'

import type { UserLike } from '@/models/like'
import { FileTextIcon, HeartOffIcon, LockIcon, RotateCwIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { Fragment, useEffect, useState } from 'react'
import { listUserLikes } from '@/api/like'
import { UserAvatar } from '@/components/common/avatar'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Link } from '@/i18n/navigation'
import { TargetType } from '@/models/types'
import { formatDateTime } from '@/utils/common/datetime'
import { getPageUrl, getPostUrl, getUserUrl } from '@/utils/common/route'

const PAGE_SIZE = 10
const CARD_CLASS = 'overflow-hidden rounded-2xl bg-card'

// 行与行之间的虚线，与文章、评论列表保持一致
function RowDivider() {
  return <div aria-hidden className="mx-6 border-t border-dashed border-foreground/10 md:mx-8" />
}

function getTargetUrl(like: UserLike) {
  const target = { id: like.target.id, slug: like.target.slug }
  return like.target.type === TargetType.Page ? getPageUrl(target) : getPostUrl({ post: target })
}

function UserLikeItem({ like }: { like: UserLike }) {
  const t = useTranslations('UserPage')
  const commonT = useTranslations('Common')
  const locale = useLocale()
  const isComment = like.targetType === TargetType.Comment

  const authorLink = () => (
    <Link href={getUserUrl(like.author, isComment ? 'comments' : 'posts')} className="font-medium text-foreground/90 transition-colors hover:text-primary">
      {like.author.nickname || like.author.username}
    </Link>
  )

  return (
    <article className="grid gap-3 px-6 py-5 md:px-8">
      <div className="flex items-center gap-3">
        <UserAvatar user={like.author} size={64} className="size-8 shrink-0" />
        <p className="min-w-0 truncate text-foreground/75">
          {isComment
            ? t.rich('liked_comment', { author: authorLink })
            : t.rich('liked_post', { author: authorLink })}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatDateTime({
            dateTimeString: like.createdAt,
            locale,
            convertShortAgo: true,
            unitI18n: {
              secondsAgo: commonT('secondsAgo'),
              minutesAgo: commonT('minutesAgo'),
              hoursAgo: commonT('hoursAgo'),
              daysAgo: commonT('daysAgo'),
            },
          })}
        </span>
      </div>
      {isComment && (
        <p className="rounded-xl bg-foreground/[.03] px-4 py-2 break-words whitespace-pre-wrap text-foreground/75">
          {like.content}
        </p>
      )}
      <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
        {isComment && <span className="shrink-0">{t('commented_on')}</span>}
        <Link href={getTargetUrl(like)} className="truncate font-medium text-foreground/75 transition-colors hover:text-primary">
          {like.target.title}
        </Link>
      </p>
    </article>
  )
}

function UserLikeItemSkeleton() {
  return (
    <div className="grid gap-3 px-6 py-5 md:px-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-4 w-48" />
    </div>
  )
}

/**
 * 用户主页的点赞列表：默认仅本人与管理员可见，公开后他人只能看到公开内容上的点赞（由后端控制）
 */
export function UserLikes({ userId, isPublic }: { userId: number, isPublic: boolean }) {
  const t = useTranslations('UserPage')
  const blogT = useTranslations('BlogHome')
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [likes, setLikes] = useState<UserLike[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    listUserLikes({ userId, page, size: PAGE_SIZE })
      .then((res) => {
        if (cancelled)
          return
        setLikes(res.data.likes || [])
        setTotal(res.data.total || 0)
      })
      .catch(() => {
        if (!cancelled) {
          setLikes([])
          setTotal(0)
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled)
          setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, page, reloadKey])

  let content: React.ReactNode
  if (loading) {
    content = (
      <div className={CARD_CLASS} aria-busy="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <Fragment key={index}>
            {index > 0 && <RowDivider />}
            <UserLikeItemSkeleton />
          </Fragment>
        ))}
      </div>
    )
  }
  else if (loadError) {
    content = (
      <div className={`${CARD_CLASS} flex flex-col items-center gap-3 px-6 py-14 text-center`} role="alert">
        <p className="text-lg font-medium text-foreground/75">{t('likes_load_failed')}</p>
        <Button variant="secondary" onClick={() => setReloadKey(k => k + 1)}>
          <RotateCwIcon aria-hidden />
          {blogT('retry')}
        </Button>
      </div>
    )
  }
  else if (likes.length === 0) {
    content = (
      <div className={`${CARD_CLASS} flex flex-col items-center gap-2 px-6 py-14 text-center`}>
        <span aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <HeartOffIcon className="size-6" />
        </span>
        <p className="text-lg font-medium text-foreground/75">{t('no_likes')}</p>
        <p className="text-sm text-muted-foreground">{t('no_likes_hint')}</p>
      </div>
    )
  }
  else {
    content = (
      <div className={CARD_CLASS}>
        {likes.map((like, index) => (
          <Fragment key={like.id}>
            {index > 0 && <RowDivider />}
            <UserLikeItem like={like} />
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <section className="grid gap-4">
      <div className="mx-4 flex items-center gap-3 md:mx-2">
        <SectionTitle className="text-xl md:text-2xl">
          {t('likes')}
          {total > 0 && <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{total}</span>}
        </SectionTitle>
        {!isPublic && (
          <Badge variant="secondary" className="rounded-md">
            <LockIcon aria-hidden />
            {t('likes_visibility')}
          </Badge>
        )}
      </div>
      {content}
      {total > 0 && (
        <PaginationController
          hideOnSinglePage
          className="flex justify-center pt-2"
          pageSize={PAGE_SIZE}
          initialPage={page}
          total={total}
          onPageChange={(next) => {
            setPage(next)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}
    </section>
  )
}
