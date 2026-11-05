'use client'
import type { CommentSubmitPayload } from './comment-input'
import type { ActiveInput } from './comment-item'
import type { Comment } from '@/models/comment'
import type { TargetType } from '@/models/types'
import { Loader2, MessageCircleHeartIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createComment, deleteComment, getComment, listComments } from '@/api/comment'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useErrorMessageT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'
import { OrderSelector } from '../common/orderby-selector'
import { SectionTitle } from '../layout/site-shell'
import { CommentInput } from './comment-input'
import { CommentItem } from './comment-item'
import './style.css'

export function CommentSection({
  targetType,
  targetId,
  totalCount = 0,
  ownerId,
}: {
  targetType: TargetType
  targetId: number
  totalCount?: number
  ownerId?: number
}) {
  const { siteInfo } = useSiteInfo()
  const t = useTranslations('Comment')
  const errorMessageT = useErrorMessageT()
  const pageSize = siteInfo.commentsPerPage || 8
  const [comments, setComments] = useState<Comment[]>([])
  const [activeInput, setActiveInput] = useState<ActiveInput>(null)
  const [page, setPage] = useState(1) // 当前页码
  const [totalCommentCount, setTotalCommentCount] = useState(totalCount) // 评论总数
  const [needLoadMore, setNeedLoadMore] = useState(false) // 是否需要加载更多，当最后一次获取的评论数小于分页大小时设为false
  const [orderBy, setOrderBy] = useState<OrderBy>(OrderBy.CreatedAt) // 排序字段，默认按创建时间
  const [desc, setDesc] = useState(true) // 是否降序，默认降序
  const [initialLoading, setInitialLoading] = useState(true) // 首屏加载中
  const [loadingMore, setLoadingMore] = useState(false) // 加载更多中
  const [translatable, setTranslatable] = useState(false) // 后端已配置 AI 时可翻译评论
  // 请求序号：排序或目标变化后，丢弃过期请求的结果
  const requestSeqRef = useRef(0)
  // 上次加载后本地删除的顶层评论数，非 0 时下一页的 offset 会错位
  const localDeletedRef = useRef(0)

  // 加载0/顶层评论
  useEffect(() => {
    const seq = ++requestSeqRef.current
    // Reset pagination state when target changes
    setPage(1)
    setNeedLoadMore(false)
    setInitialLoading(true)
    setLoadingMore(false)
    localDeletedRef.current = 0

    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: 1,
      size: pageSize,
      commentId: 0,
    }).then((response) => {
      if (seq !== requestSeqRef.current)
        return
      const list: Comment[] = response.data.comments || []
      setComments(list)
      setTranslatable(Boolean(response.data.translatable))
      // If we got fewer comments than requested, no more pages
      setNeedLoadMore(list.length >= pageSize)
    }).catch((error) => {
      if (seq !== requestSeqRef.current)
        return
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    }).finally(() => {
      if (seq === requestSeqRef.current)
        setInitialLoading(false)
    })
  }, [targetId, targetType, pageSize, orderBy, desc, t])

  const onCommentSubmitted = async ({
    commentContent,
    attachments,
    isPrivate,
    showClientInfo,
  }: CommentSubmitPayload) => {
    try {
      const res = await createComment({
        targetType,
        targetId,
        content: commentContent,
        attachmentIds: attachments.map(attachment => attachment.id),
        replyId: null,
        isPrivate,
        showClientInfo,
      })
      notifySuccess(t('comment_success'), { key: 'comment', icon: <MessageCircleHeartIcon aria-hidden className="text-sky-400" /> })
      setTotalCommentCount(c => c + 1)
      setActiveInput(null)
      getComment({ id: res.data.id }).then((response) => {
        // 按 id 去重，避免与后续“加载更多”的结果重复
        setComments(prevComments => [response.data, ...prevComments.filter(c => c.id !== response.data.id)])
      }).catch(() => {})
    }
    catch (error) {
      toast.error(`${t('comment_failed')}: ${errorMessageT(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
  }

  const onCountChange = (delta: number) => {
    setTotalCommentCount(c => Math.max(0, c + delta))
  }

  // 失败时抛出，由删除确认气泡统一提示并保持打开；主评论下的回复会一并删除
  const onCommentDelete = async ({ commentId }: { commentId: number }) => {
    await deleteComment({ id: commentId })
    toast.success(t('delete_success'))
    const removed = comments.find(comment => comment.id === commentId)
    setComments(prevComments => prevComments.filter(comment => comment.id !== commentId))
    onCountChange(-1 - (removed?.threadCount ?? 0))
    localDeletedRef.current += 1
  }

  const handleLoadMore = () => {
    if (loadingMore || initialLoading)
      return
    const seq = requestSeqRef.current
    const nextPage = page + 1
    // 有本地删除时 offset 已错位，改为从第一页重新拉取到下一页，保证不漏评论
    const refetchAll = localDeletedRef.current > 0
    setLoadingMore(true)
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: refetchAll ? 1 : nextPage,
      size: refetchAll ? pageSize * nextPage : pageSize,
      commentId: 0,
    }).then((response) => {
      if (seq !== requestSeqRef.current)
        return
      const list: Comment[] = response.data.comments || []
      setNeedLoadMore(list.length >= (refetchAll ? pageSize * nextPage : pageSize))
      if (refetchAll) {
        localDeletedRef.current = 0
        // 服务端结果已包含本地新增的评论，直接替换
        setComments(list)
      }
      else {
        // 按 id 去重：本地新增评论会让后续页的 offset 后移，导致重复
        setComments((prevComments) => {
          const ids = new Set(prevComments.map(c => c.id))
          return [...prevComments, ...list.filter(c => !ids.has(c.id))]
        })
      }
      setPage(nextPage)
    }).catch((error) => {
      if (seq !== requestSeqRef.current)
        return
      toast.error(`${t('load_failed')}: ${errorMessageT(error)}`)
    }).finally(() => {
      if (seq === requestSeqRef.current)
        setLoadingMore(false)
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="text-xl md:text-2xl">
          {t('comment')}
          <span className="ml-2 text-base font-medium text-foreground/50 tabular-nums">{totalCommentCount}</span>
        </SectionTitle>
        <div className="flex">
          <OrderSelector
            value={{ orderBy, desc }}
            onOrderChange={(o) => {
              setOrderBy(o.orderBy)
              setDesc(o.desc)
            }}
            orderBys={[
              OrderBy.CreatedAt,
              OrderBy.LikeCount,
              OrderBy.CommentCount,
              OrderBy.UpdatedAt,
            ]}
          />
        </div>
      </div>
      <div className="mt-4">
        <CommentInput collapsible showAvatar onCommentSubmitted={onCommentSubmitted} />
      </div>
      <div className="mt-2">
        {initialLoading
          ? <CommentLoading />
          : comments.map(comment => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onCommentDelete={onCommentDelete}
                activeInput={activeInput}
                setActiveInputId={setActiveInput}
                onCountChange={onCountChange}
                ownerId={ownerId}
                translatable={translatable}
              />
            ))}
        {!initialLoading && (needLoadMore
          ? (
              <div className="flex justify-center my-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-foreground/50"
                  disabled={loadingMore}
                  onClick={handleLoadMore}
                >
                  {loadingMore && <Loader2 className="animate-spin" />}
                  {loadingMore ? t('loading') : t('load_more')}
                </Button>
              </div>
            )
          : (
              <p className="my-4 text-center text-sm text-foreground/30">{t('no_more')}</p>
            ))}
      </div>
    </div>
  )
}

function CommentLoading() {
  return (
    <div className="space-y-6 py-8">
      {[...Array.from({ length: 3 })].map((_, i) => (
        <div key={i} className="flex gap-3 fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
          <Skeleton className="w-10 h-10 rounded-full fade-in" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4 fade-in" />
            <Skeleton className="h-4 w-3/4 fade-in" />
            <Skeleton className="h-4 w-2/3 fade-in" />
          </div>
        </div>
      ))}
    </div>
  )
}
