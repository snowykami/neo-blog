'use client'
import type { Comment } from '@/models/comment'
import type { TargetType } from '@/models/types'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createComment, deleteComment, getComment, listComments } from '@/api/comment'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { getErrorMessage } from '@/utils/common/error'
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
  const pageSize = siteInfo.commentsPerPage || 8
  const [comments, setComments] = useState<Comment[]>([])
  const [activeInput, setActiveInput] = useState<{
    id: number
    type: 'reply' | 'edit'
  } | null>(null)
  const [page, setPage] = useState(1) // 当前页码
  const [totalCommentCount, setTotalCommentCount] = useState(totalCount) // 评论总数
  const [needLoadMore, setNeedLoadMore] = useState(false) // 是否需要加载更多，当最后一次获取的评论数小于分页大小时设为false
  const [orderBy, setOrderBy] = useState<OrderBy>(OrderBy.CreatedAt) // 排序字段，默认按创建时间
  const [desc, setDesc] = useState(true) // 是否降序，默认降序
  const [initialLoading, setInitialLoading] = useState(true) // 首屏加载中
  const [loadingMore, setLoadingMore] = useState(false) // 加载更多中
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
      // If we got fewer comments than requested, no more pages
      setNeedLoadMore(list.length >= pageSize)
    }).catch((error) => {
      if (seq !== requestSeqRef.current)
        return
      toast.error(`${t('load_failed')}: ${getErrorMessage(error)}`)
    }).finally(() => {
      if (seq === requestSeqRef.current)
        setInitialLoading(false)
    })
  }, [targetId, targetType, pageSize, orderBy, desc, t])

  const onCommentSubmitted = async ({
    commentContent,
    isPrivate,
    showClientInfo,
  }: {
    commentContent: string
    isPrivate: boolean
    showClientInfo: boolean
  }) => {
    try {
      const res = await createComment({
        targetType,
        targetId,
        content: commentContent,
        replyId: null,
        isPrivate,
        showClientInfo,
      })
      toast.success(t('comment_success'))
      setTotalCommentCount(c => c + 1)
      setActiveInput(null)
      getComment({ id: res.data.id }).then((response) => {
        // 按 id 去重，避免与后续“加载更多”的结果重复
        setComments(prevComments => [response.data, ...prevComments.filter(c => c.id !== response.data.id)])
      }).catch(() => {})
    }
    catch (error) {
      toast.error(`${t('comment_failed')}: ${getErrorMessage(error)}`)
      // 抛出以通知输入框保留内容
      throw error
    }
  }

  const onReplySubmitted = () => {
    setTotalCommentCount(c => c + 1)
  }

  const onCommentDelete = ({ commentId }: { commentId: number }) => {
    deleteComment({ id: commentId })
      .then(() => {
        toast.success(t('delete_success'))
        setComments(prevComments => prevComments.filter(comment => comment.id !== commentId))
        setTotalCommentCount(c => Math.max(0, c - 1))
        localDeletedRef.current += 1
      })
      .catch((error) => {
        toast.error(`${t('delete_failed')}: ${getErrorMessage(error)}`)
      })
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
      toast.error(`${t('load_failed')}: ${getErrorMessage(error)}`)
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
      <CommentInput onCommentSubmitted={onCommentSubmitted} />
      <div className="mt-4">
        {initialLoading
          ? <CommentLoading />
          : comments.map((comment, idx) => (
              <div key={comment.id} className="" style={{ animationDelay: `${idx * 60}ms` }}>
                <Separator className="my-3 border-t border-dashed border-foreground/10 bg-transparent" />
                <CommentItem
                  comment={comment}
                  parentComment={null}
                  onCommentDelete={onCommentDelete}
                  activeInput={activeInput}
                  setActiveInputId={setActiveInput}
                  onReplySubmitted={onReplySubmitted}
                  ownerId={ownerId}
                />
              </div>
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
