'use client'
import type { Comment } from '@/models/comment'
import type { TargetType } from '@/models/types'
import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createComment, deleteComment, getComment, listComments } from '@/api/comment'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteInfo } from '@/contexts/site-info-context'
import { OrderBy } from '@/models/common'
import { OrderSelector } from '../common/orderby-selector'
import { CommentInput } from './comment-input'
import { CommentItem } from './comment-item'
import './style.css'

export function CommentSection(
  {
    targetType,
    targetId,
    totalCount = 0,
    ownerId,
  }: {
    targetType: TargetType
    targetId: number
    totalCount?: number
    ownerId?: number
  },
) {
  const { siteInfo } = useSiteInfo()
  const t = useTranslations('Comment')
  const [comments, setComments] = useState<Comment[]>([])
  const [activeInput, setActiveInput] = useState<{ id: number, type: 'reply' | 'edit' } | null>(null)
  const [page, setPage] = useState(1) // 当前页码
  const [totalCommentCount, setTotalCommentCount] = useState(totalCount) // 评论总数
  const [needLoadMore, setNeedLoadMore] = useState(true) // 是否需要加载更多，当最后一次获取的评论数小于分页大小时设为false
  const [orderBy, setOrderBy] = useState<OrderBy>(OrderBy.CreatedAt) // 排序字段，默认按创建时间
  const [desc, setDesc] = useState(true) // 是否降序，默认降序
  // 加载0/顶层评论
  useEffect(() => {
    // Reset pagination state when target changes
    setPage(1)
    setNeedLoadMore(true)

    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: 1,
      size: siteInfo.commentsPerPage || 8,
      commentId: 0,
    }).then((response) => {
      setComments(response.data.comments)
      // If we got fewer comments than requested, no more pages
      if (response.data.comments.length < (siteInfo.commentsPerPage || 8)) {
        setNeedLoadMore(false)
      }
    })
  }, [targetId, targetType, siteInfo.commentsPerPage, orderBy, desc])

  const onCommentSubmitted = ({ commentContent, isPrivate, showClientInfo }: { commentContent: string, isPrivate: boolean, showClientInfo: boolean }) => {
    createComment({
      targetType,
      targetId,
      content: commentContent,
      replyId: null,
      isPrivate,
      showClientInfo,
    }).then((res) => {
      toast.success(t('comment_success'))
      setTotalCommentCount(c => c + 1)
      getComment({ id: res.data.id }).then((response) => {
        setComments(prevComments => [response.data, ...prevComments])
      })
      setActiveInput(null)
    })
  }

  const onReplySubmitted = () => {
    setTotalCommentCount(c => c + 1)
  }

  const onCommentDelete = ({ commentId }: { commentId: number }) => {
    deleteComment({ id: commentId }).then(() => {
      toast.success(t('delete_success'))
      setComments(prevComments => prevComments.filter(comment => comment.id !== commentId))
      setTotalCommentCount(c => c - 1)
    }).catch((error) => {
      toast.error(`${t('delete_failed')}: ${error.message}`)
    })
  }

  const handleLoadMore = () => {
    const nextPage = page + 1
    listComments({
      targetType,
      targetId,
      depth: 0,
      orderBy,
      desc,
      page: nextPage,
      size: siteInfo.commentsPerPage || 8,
      commentId: 0,
    }).then((response) => {
      if (response.data.comments.length < (siteInfo.commentsPerPage || 8)) {
        setNeedLoadMore(false)
      }
      setComments(prevComments => [...prevComments, ...response.data.comments])
      setPage(nextPage)
    })
  }

  return (
    <div>
      <div className="flex justify-between">
        <div className="font-bold text-2xl">
          {t('comment')}
          {' '}
          (
          {totalCommentCount}
          )
        </div>
        <div className="flex">
          <OrderSelector
            initialOrder={{ orderBy, desc }}
            onOrderChange={(o) => {
              setOrderBy(o.orderBy)
              setDesc(o.desc)
            }}
            orderBys={[OrderBy.CreatedAt, OrderBy.LikeCount, OrderBy.CommentCount, OrderBy.UpdatedAt]}
          />
        </div>
      </div>
      <CommentInput
        onCommentSubmitted={onCommentSubmitted}
      />
      <div className="mt-4">
        <Suspense fallback={<CommentLoading />}>
          {comments.map((comment, idx) => (
            <div key={comment.id} className="" style={{ animationDelay: `${idx * 60}ms` }}>
              <Separator className="my-2" />
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
        </Suspense>
        {needLoadMore
          ? (
              <p onClick={handleLoadMore} className="text-center text-sm text-gray-500 my-4 cursor-pointer hover:underline">
                {t('load_more')}
              </p>
            )
          : (
              <p className="text-center text-sm text-gray-500 my-4">
                {t('no_more')}
              </p>
            )}
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
