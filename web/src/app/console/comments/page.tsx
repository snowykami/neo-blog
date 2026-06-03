'use client'

import type { Comment } from '@/models/comment'
import type { BaseResponseError } from '@/models/resp'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { listCommentsAdmin } from '@/api/admin'
import { deleteComment } from '@/api/comment'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDevice } from '@/contexts/device-context'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { OrderBy } from '@/models/common'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export default function CommentsManage() {
  const commonT = useCommonT()
  const operationT = useOperationT()
  const metricsT = useTranslations('Metrics')
  const { isMobile } = useDevice()
  const [comments, setComments] = useState<Comment[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>(Object.values(OrderBy))
      .withDefault(OrderBy.CreatedAt)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [desc, setDesc] = useQueryState(
    'desc',
    parseAsBoolean.withDefault(true)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [size, setSize] = useQueryState(
    'size',
    parseAsInteger
      .withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState('', 200)

  const fetchComments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listCommentsAdmin({
        page,
        size,
        orderBy,
        desc,
      }, debouncedQueryInput)
      setComments(res.data.comments)
      setTotal(res.data.total)
    }
    catch (error) {
      const err = error as BaseResponseError
      toast.error(`${operationT('fetch_failed')}: ${err?.response?.data?.message || err.message}`)
    }
    finally {
      setLoading(false)
    }
  }, [debouncedQueryInput, desc, operationT, orderBy, page, size])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  useEffect(() => {
    setPage(1)
  }, [debouncedQueryInput, setPage])

  const onOrderChange = useCallback(
    ({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
      setOrderBy(orderBy)
      setDesc(desc)
      setPage(1)
    },
    [setOrderBy, setDesc, setPage],
  )

  const handleDelete = async (comment: Comment) => {
    try {
      await deleteComment({ id: comment.id })
      toast.success(operationT('delete_success'))
      setComments(prev => prev.filter(item => item.id !== comment.id))
      setTotal(prev => Math.max(0, prev - 1))
    }
    catch (error) {
      const err = error as BaseResponseError
      toast.error(`${operationT('delete_failed')}: ${err?.response?.data?.message || err.message}`)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-full sm:w-72"
          type="search"
          placeholder={commonT('search')}
          value={queryInput}
          onChange={e => setQueryInput(e.target.value)}
        />
        <OrderSelector
          initialOrder={{ orderBy, desc }}
          onOrderChange={onOrderChange}
          orderBys={[OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.LikeCount]}
        />
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>评论</TableHead>
            <TableHead>目标</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">加载中...</TableCell>
            </TableRow>
          )}
          {!loading && comments.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">暂无评论</TableCell>
            </TableRow>
          )}
          {!loading && comments.map(comment => (
            <CommentRow key={comment.id} comment={comment} onDelete={handleDelete} />
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-center py-4">
        {total > 0 && (
          <PaginationController
            initialPage={page}
            onPageChange={setPage}
            total={total}
            pageSize={size}
          />
        )}
        <PageSizeSelector
          initialSize={size}
          onSizeChange={(nextSize) => {
            setSize(nextSize)
            setPage(1)
          }}
        />
        {' '}
        {metricsT('per_page')}
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  onDelete,
}: {
  comment: Comment
  onDelete: (comment: Comment) => void
}) {
  const operationT = useOperationT()
  return (
    <TableRow>
      <TableCell className="max-w-[28rem] whitespace-normal">
        <div className="line-clamp-3 break-words">{comment.content || '无评论内容'}</div>
        {comment.depth > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            回复层级:
            {' '}
            {comment.depth + 1}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="font-mono text-xs">{comment.targetType}</div>
        <div className="text-xs text-muted-foreground">
          #
          {comment.targetId}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {comment.user?.avatarUrl
            ? (
                <Image
                  src={comment.user.avatarUrl}
                  alt={comment.user.username || 'avatar'}
                  width={32}
                  height={32}
                  className="size-8 rounded-md object-cover"
                />
              )
            : (
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-xs">
                  {comment.user?.username?.[0] || '?'}
                </div>
              )}
          <div className="min-w-0">
            <div className="truncate text-sm">{comment.user?.nickname || comment.user?.username || '未知用户'}</div>
            <div className="truncate text-xs text-muted-foreground">{comment.user?.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {comment.isPrivate && <Badge variant="secondary">私密</Badge>}
          {comment.replyCount > 0 && (
            <Badge variant="outline">
              {comment.replyCount}
              {' '}
              回复
            </Badge>
          )}
          {comment.likeCount > 0 && (
            <Badge variant="outline">
              {comment.likeCount}
              {' '}
              赞
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{new Date(comment.createdAt).toLocaleString()}</TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onDelete(comment)}
        >
          {operationT('delete')}
        </Button>
      </TableCell>
    </TableRow>
  )
}
