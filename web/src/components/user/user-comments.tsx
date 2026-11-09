'use client'

import type { UserComment } from '@/models/comment'
import { ArrowRightIcon, FileTextIcon, LockIcon, MessageSquareOffIcon, RotateCwIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { parseAsInteger, useQueryState } from 'nuqs'
import { Fragment, useEffect, useState } from 'react'
import { listUserComments } from '@/api/comment'
import { CommentAttachments } from '@/components/comment/comment-attachments'
import { useCommentLimits } from '@/components/comment/comment-limits'
import { CommentText } from '@/components/comment/comment-text'
import { UserAvatar } from '@/components/common/avatar'
import { PaginationController } from '@/components/common/pagination'
import { SectionTitle } from '@/components/layout/site-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderBy } from '@/models/common'
import { TargetType } from '@/models/types'
import { formatDateTime } from '@/utils/common/datetime'
import { getPageUrl, getPostUrl, withCommentAnchor } from '@/utils/common/route'

const PAGE_SIZE = 10
const CARD_CLASS = 'overflow-hidden rounded-2xl bg-card'

// 行与行之间的虚线，与文章列表保持一致
function RowDivider() {
  return <div aria-hidden className="mx-6 border-t border-dashed border-foreground/10 md:mx-8" />
}

function getTargetUrl(comment: UserComment) {
  const target = { id: comment.target.id, slug: comment.target.slug }
  const url = comment.target.type === TargetType.Page ? getPageUrl(target) : getPostUrl({ post: target })
  // 与通知深链同一套约定：带上 ?comment=<id>，打开后定位并高亮这条评论
  return withCommentAnchor(url, comment.id)
}

function UserCommentItem({ comment }: { comment: UserComment }) {
  const t = useTranslations('UserPage')
  const commonT = useTranslations('Common')
  const locale = useLocale()
  const { collapsedLines } = useCommentLimits()

  return (
    <article className="grid gap-3 px-6 py-5 md:px-8">
      <div className="flex items-center gap-3">
        <UserAvatar user={comment.user} size={64} className="size-8 shrink-0" />
        <span className="font-medium text-foreground/90">{comment.user.nickname || comment.user.username}</span>
        <span className="text-xs text-foreground/50 tabular-nums">
          {formatDateTime({
            dateTimeString: comment.createdAt,
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
        {comment.isPrivate && (
          <Badge variant="secondary" className="rounded-md">
            <LockIcon aria-hidden />
            {commonT('private')}
          </Badge>
        )}
      </div>
      {comment.content.trim() && (
        <p className="rounded-xl bg-foreground/[.03] px-4 py-2 break-words whitespace-pre-wrap text-foreground/75">
          {/* 与文章评论区一致：超过配置行数先折叠 */}
          <CommentText content={comment.content} lines={collapsedLines} />
        </p>
      )}
      <CommentAttachments attachments={comment.attachments} />
      {/* 整行都是链接：点标题或右侧提示都能跳到目标页面并定位到这条评论 */}
      <Link
        href={getTargetUrl(comment)}
        className="group -mx-2 flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-foreground/50 transition-colors hover:bg-foreground/[.05] hover:text-foreground/70"
      >
        <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="shrink-0">{t('commented_on')}</span>
        <span className="truncate font-medium text-foreground/75 transition-colors group-hover:text-primary">
          {comment.target.title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-2 text-xs text-foreground/40 transition-colors group-hover:text-primary">
          <span className="hidden sm:inline">{t('view_comment')}</span>
          <ArrowRightIcon aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </article>
  )
}

function UserCommentItemSkeleton() {
  return (
    <div className="grid gap-3 px-6 py-5 md:px-8">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-4 w-48" />
    </div>
  )
}

/**
 * 用户主页的评论列表：访客与他人只能看到公开目标下的公开评论（由后端控制）
 */
export function UserComments({ userId }: { userId: number }) {
  const t = useTranslations('UserPage')
  const blogT = useTranslations('BlogHome')
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [comments, setComments] = useState<UserComment[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    listUserComments({ userId, page, size: PAGE_SIZE, orderBy: OrderBy.CreatedAt, desc: true })
      .then((res) => {
        if (cancelled)
          return
        setComments(res.data.comments || [])
        setTotal(res.data.total || 0)
      })
      .catch(() => {
        if (!cancelled) {
          setComments([])
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
            <UserCommentItemSkeleton />
          </Fragment>
        ))}
      </div>
    )
  }
  else if (loadError) {
    content = (
      <div className={`${CARD_CLASS} flex flex-col items-center gap-3 px-6 py-14 text-center`} role="alert">
        <p className="text-lg font-medium text-foreground/75">{t('comments_load_failed')}</p>
        <Button variant="secondary" onClick={() => setReloadKey(k => k + 1)}>
          <RotateCwIcon aria-hidden />
          {blogT('retry')}
        </Button>
      </div>
    )
  }
  else if (comments.length === 0) {
    content = (
      <div className={`${CARD_CLASS} flex flex-col items-center gap-2 px-6 py-14 text-center`}>
        <span aria-hidden className="mb-1 flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <MessageSquareOffIcon className="size-6" />
        </span>
        <p className="text-lg font-medium text-foreground/75">{t('no_comments')}</p>
        <p className="text-sm text-foreground/50">{t('no_public_comments')}</p>
      </div>
    )
  }
  else {
    content = (
      <div className={CARD_CLASS}>
        {comments.map((comment, index) => (
          <Fragment key={comment.id}>
            {index > 0 && <RowDivider />}
            <UserCommentItem comment={comment} />
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <section className="grid gap-4">
      <SectionTitle className="mx-4 text-xl md:mx-2 md:text-2xl">
        {t('comments')}
        {total > 0 && <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{total}</span>}
      </SectionTitle>
      {content}
      {total > 0 && (
        <PaginationController
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
