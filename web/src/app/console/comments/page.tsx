'use client'

import type { Comment } from '@/models/comment'
import { useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listCommentsAdmin } from '@/api/admin'
import { deleteComment } from '@/api/comment'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { SafeImage } from '@/components/common/safe-image'
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
import { getErrorMessage } from '@/utils/common/error'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export default function CommentsManage() {
  const commonT = useCommonT()
  const operationT = useOperationT()
  const metricsT = useTranslations('Metrics')
  const t = useTranslations('Console.comments')
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
      toast.error(`${operationT('fetch_failed')}: ${getErrorMessage(error)}`)
    }
    finally {
      setLoading(false)
    }
  }, [debouncedQueryInput, desc, operationT, orderBy, page, size])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  // 仅在搜索词真正变化时重置页码，避免挂载时把 URL 中的页码重置为 1
  const prevQueryRef = useRef(debouncedQueryInput)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQueryInput)
      return
    prevQueryRef.current = debouncedQueryInput
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
      // 删除可能连带回复，重新拉取；删光当前页时回退到上一页
      if (comments.length <= 1 && page > 1)
        await setPage(page - 1)
      else
        await fetchComments()
    }
    catch (error) {
      toast.error(`${operationT('delete_failed')}: ${getErrorMessage(error)}`)
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
          value={{ orderBy, desc }}
          onOrderChange={onOrderChange}
          orderBys={[OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.LikeCount]}
        />
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('comment')}</TableHead>
            <TableHead>{t('target')}</TableHead>
            <TableHead>{t('user')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>{t('time')}</TableHead>
            <TableHead className="text-right">{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('loading')}</TableCell>
            </TableRow>
          )}
          {!loading && comments.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell>
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
            page={page}
            onPageChange={setPage}
            total={total}
            pageSize={size}
          />
        )}
        <PageSizeSelector
          size={size}
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
  onDelete: (comment: Comment) => Promise<void>
}) {
  const operationT = useOperationT()
  const t = useTranslations('Console.comments')
  return (
    <TableRow>
      <TableCell className="max-w-[28rem] whitespace-normal">
        <div className="line-clamp-3 break-words">{comment.content || t('no_content')}</div>
        {comment.depth > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t('reply_depth', { depth: comment.depth + 1 })}
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
          {/* 没有头像或头像失效时显示用户名首字母 */}
          <SafeImage
            src={comment.user?.avatarUrl}
            alt={comment.user?.username || 'avatar'}
            width={32}
            height={32}
            className="size-8 rounded-md object-cover"
            fallback={(
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs">
                {comment.user?.username?.[0] || '?'}
              </div>
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm">{comment.user?.nickname || comment.user?.username || t('unknown_user')}</div>
            {/* 邮箱仅在后端返回时展示 */}
            {comment.user?.email && <div className="truncate text-xs text-muted-foreground">{comment.user.email}</div>}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {comment.isPrivate && <Badge variant="secondary">{t('private')}</Badge>}
          {comment.replyCount > 0 && (
            <Badge variant="outline">{t('reply_count', { count: comment.replyCount })}</Badge>
          )}
          {comment.likeCount > 0 && (
            <Badge variant="outline">{t('like_count', { count: comment.likeCount })}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{new Date(comment.createdAt).toLocaleString()}</TableCell>
      <TableCell className="text-right">
        {/* 删除评论可能连带其回复，需二次确认 */}
        <ConfirmDialog
          title={operationT('confirm_delete')}
          description={t('delete_description')}
          confirmLabel={operationT('delete')}
          confirmVariant="destructive"
          onConfirm={() => onDelete(comment)}
        >
          <Button size="sm" variant="destructive">
            {operationT('delete')}
          </Button>
        </ConfirmDialog>
      </TableCell>
    </TableRow>
  )
}
