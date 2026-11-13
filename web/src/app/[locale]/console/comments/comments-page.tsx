'use client'

import type { UserComment } from '@/models/comment'
import { Paperclip } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listCommentsAdmin } from '@/api/admin'
import { batchDeleteComments, deleteComment } from '@/api/comment'
import { UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { STICKY_ACTIONS_CLASS } from '@/components/console/common/sticky-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link } from '@/i18n/navigation'
import { OrderBy } from '@/models/common'
import { formatLocation } from '@/utils/common/location'
import { getTargetViewUrl } from '@/utils/common/route'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10
const EMPTY_COMMENTS: UserComment[] = []

export default function CommentsManage() {
  const commonT = useCommonT()
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const metricsT = useTranslations('Metrics')
  const t = useTranslations('Console.comments')
  const { isMobile } = useDevice()
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())

  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const commentsQuery = useConsoleQuery(
    ['admin/comments', page, size, orderBy, desc, debouncedQueryInput],
    () => listCommentsAdmin({ page, size, orderBy, desc }, debouncedQueryInput).then(res => res.data),
    { onError: error => toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error)}`) },
  )
  const comments = commentsQuery.data?.comments ?? EMPTY_COMMENTS
  const total = commentsQuery.data?.total ?? 0
  // 有上次的数据时照常显示，后台刷新不再换成「加载中」
  const loading = commentsQuery.loading && !commentsQuery.data
  const fetchComments = commentsQuery.refresh

  const activeSelectedIds = useMemo(
    () => comments.filter(c => selectedIds.has(c.id)).map(c => c.id),
    [comments, selectedIds],
  )
  const allSelected = comments.length > 0 && activeSelectedIds.length === comments.length
  const partiallySelected = activeSelectedIds.length > 0 && !allSelected

  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? new Set(comments.map(c => c.id)) : new Set())
  }, [comments])

  const toggleSelectOne = useCallback((id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked)
        next.add(id)
      else
        next.delete(id)
      return next
    })
  }, [])

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

  // 删除失败时抛出，由确认组件统一提示并保持打开
  const handleDelete = async (comment: UserComment) => {
    await deleteComment({ id: comment.id })
    toast.success(operationT('delete_success'))
    setSelectedIds((prev) => {
      if (!prev.has(comment.id))
        return prev
      const next = new Set(prev)
      next.delete(comment.id)
      return next
    })
    // 删除可能连带回复，重新拉取；删光当前页时回退到上一页
    if (comments.length <= 1 && page > 1)
      await setPage(page - 1)
    else
      await fetchComments()
  }

  const handleBatchDelete = async () => {
    if (activeSelectedIds.length === 0)
      return
    await batchDeleteComments({ ids: activeSelectedIds })
    toast.success(operationT('delete_success'))
    const deletingAllOnPage = activeSelectedIds.length >= comments.length
    setSelectedIds(new Set())
    if (deletingAllOnPage && page > 1)
      await setPage(page - 1)
    else
      await fetchComments()
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
      {activeSelectedIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('selected_count', { count: activeSelectedIds.length })}
          </span>
          <div className="flex items-center gap-2">
            <ConfirmDialog
              title={operationT('confirm_delete')}
              description={t('batch_delete_description', { count: activeSelectedIds.length })}
              confirmLabel={operationT('delete')}
              errorText={operationT('delete_failed')}
              confirmVariant="destructive"
              onConfirm={handleBatchDelete}
            >
              <Button size="sm" variant="destructive">
                {operationT('delete')}
              </Button>
            </ConfirmDialog>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              {operationT('cancel')}
            </Button>
          </div>
        </div>
      )}
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
                disabled={comments.length === 0}
                onCheckedChange={checked => toggleSelectAll(checked === true)}
                aria-label={t('select_all')}
              />
            </TableHead>
            <TableHead>{t('comment')}</TableHead>
            <TableHead>{t('target')}</TableHead>
            <TableHead>{t('user')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>{t('time')}</TableHead>
            <TableHead className={`text-right ${STICKY_ACTIONS_CLASS}`}>{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t('loading')}</TableCell>
            </TableRow>
          )}
          {!loading && comments.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell>
            </TableRow>
          )}
          {!loading && comments.map(comment => (
            <CommentRow
              key={comment.id}
              comment={comment}
              selected={selectedIds.has(comment.id)}
              onSelectChange={checked => toggleSelectOne(comment.id, checked)}
              onDelete={handleDelete}
            />
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
  selected,
  onSelectChange,
  onDelete,
}: {
  comment: UserComment
  selected: boolean
  onSelectChange: (checked: boolean) => void
  onDelete: (comment: UserComment) => Promise<void>
}) {
  const operationT = useOperationT()
  const t = useTranslations('Console.comments')
  const format = useFormatter()
  const clientInfo = [comment.browser, comment.os, comment.location && formatLocation({ location: comment.location, short: true })]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' · ')
  return (
    <TableRow>
      <TableCell className="w-10">
        <Checkbox
          checked={selected}
          onCheckedChange={checked => onSelectChange(checked === true)}
          aria-label={comment.content || String(comment.id)}
        />
      </TableCell>
      <TableCell className="max-w-[28rem] whitespace-normal">
        <div className="line-clamp-3 break-words">{comment.content || t('no_content')}</div>
        {!!comment.attachments?.length && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip aria-hidden className="size-3" />
            {t('attachments', { count: comment.attachments.length })}
          </div>
        )}
        {comment.depth > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t('reply_depth', { depth: comment.depth + 1 })}
          </div>
        )}
      </TableCell>
      <TableCell className="max-w-56 min-w-32 whitespace-normal">
        {/* 显示所属文章 / 页面的标题；私密目标前台 404，链到后台预览 */}
        {comment.target.title
          ? (
              <Link href={getTargetViewUrl(comment.target)} target="_blank" prefetch={false} className="line-clamp-2 text-sm break-words hover:text-primary hover:underline">
                {comment.target.title}
              </Link>
            )
          : <div className="text-sm text-muted-foreground">{t('target_deleted')}</div>}
        <div className="text-xs text-muted-foreground">{t(comment.targetType === 'page' ? 'target_page' : 'target_post')}</div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {comment.user && <UserAvatar user={comment.user} size={64} className="size-8" fallbackClassName="text-xs" />}
          <div className="min-w-0">
            <div className="truncate text-sm">{comment.user?.nickname || comment.user?.username || t('unknown_user')}</div>
            {/* 邮箱仅在后端返回时展示 */}
            {comment.user?.email && <div className="truncate text-xs text-muted-foreground">{comment.user.email}</div>}
            {/* 设备与归属地：前台只在评论者选择公开时显示，后台管理员始终可见 */}
            {clientInfo && <div className="truncate text-xs text-muted-foreground" title={clientInfo}>{clientInfo}</div>}
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
      <TableCell>{format.dateTime(new Date(comment.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</TableCell>
      <TableCell className={`text-right ${STICKY_ACTIONS_CLASS}`}>
        {/* 有回复时删除会连带整棵回复树，用 AlertDialog 说明后果；否则就地确认 */}
        {comment.replyCount > 0
          ? (
              <ConfirmDialog
                title={operationT('confirm_delete')}
                description={t('delete_with_replies_description', { count: comment.replyCount })}
                confirmLabel={operationT('delete')}
                errorText={operationT('delete_failed')}
                confirmVariant="destructive"
                onConfirm={() => onDelete(comment)}
              >
                <Button size="sm" variant="destructive">
                  {operationT('delete')}
                </Button>
              </ConfirmDialog>
            )
          : (
              <Popconfirm
                title={operationT('confirm_delete')}
                description={operationT('delete_description')}
                confirmText={operationT('delete')}
                errorText={operationT('delete_failed')}
                destructive
                onConfirm={() => onDelete(comment)}
              >
                <Button size="sm" variant="destructive">
                  {operationT('delete')}
                </Button>
              </Popconfirm>
            )}
      </TableCell>
    </TableRow>
  )
}
