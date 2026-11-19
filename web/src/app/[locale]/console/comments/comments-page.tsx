'use client'

import type { CommentModerationCategory, UserComment } from '@/models/comment'
import { Bot, CheckCircle2, Paperclip, ShieldAlert } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { listCommentsAdmin, updateCommentsModerationAdmin } from '@/api/admin'
import { batchDeleteComments, deleteComment } from '@/api/comment'
import { UserAvatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector } from '@/components/common/page-size-selector'
import { PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { STICKY_ACTIONS_CLASS } from '@/components/console/common/sticky-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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
import { cn } from '@/lib/utils'
import { OrderBy } from '@/models/common'
import { formatLocation } from '@/utils/common/location'
import { getTargetViewUrl } from '@/utils/common/route'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10
const EMPTY_COMMENTS: UserComment[] = []
const COMMENT_ORDER_BYS = [OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.LikeCount, OrderBy.CommentCount] as const
const MODERATION_FILTERS = ['all', 'rejected', 'pending', 'approved'] as const
type ModerationFilter = (typeof MODERATION_FILTERS)[number]
const KNOWN_CATEGORIES = new Set<CommentModerationCategory>(['politics', 'trolling', 'porn', 'violence', 'scam', 'other'])

export default function CommentsManage() {
  const commonT = useCommonT()
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const metricsT = useTranslations('Metrics')
  const t = useTranslations('Console.comments')
  const { isMobile } = useDevice()
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>([...COMMENT_ORDER_BYS])
      .withDefault(OrderBy.CreatedAt)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [desc, setDesc] = useQueryState(
    'desc',
    parseAsBoolean.withDefault(true)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [moderationFilter, setModerationFilter] = useQueryState(
    'moderation',
    parseAsStringEnum<ModerationFilter>([...MODERATION_FILTERS])
      .withDefault('all')
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
  const [moderatingIds, setModeratingIds] = useState<Set<number>>(() => new Set())

  const backendModerationParam = moderationFilter === 'all' ? '' : moderationFilter

  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const commentsQuery = useConsoleQuery(
    ['admin/comments', page, size, orderBy, desc, debouncedQueryInput, backendModerationParam],
    () => listCommentsAdmin({ page, size, orderBy, desc }, debouncedQueryInput, backendModerationParam).then(res => res.data),
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

  const onModerationFilterChange = useCallback(
    (value: string) => {
      setModerationFilter((value as ModerationFilter) || 'all')
      setSelectedIds(new Set())
      setPage(1)
    },
    [setModerationFilter, setPage],
  )

  const handleModeration = async (ids: number[], status: 'approved' | 'rejected') => {
    if (ids.length === 0)
      return
    setModeratingIds(prev => new Set([...prev, ...ids]))
    try {
      await updateCommentsModerationAdmin({ ids, status })
      toast.success(status === 'approved' ? t('moderation_approved_toast') : t('moderation_rejected_toast'))
      const clearingFilteredPage = moderationFilter !== 'all' && moderationFilter !== status && ids.length >= comments.length
      setSelectedIds((prev) => {
        if (prev.size === 0)
          return prev
        const next = new Set(prev)
        for (const id of ids)
          next.delete(id)
        return next
      })
      if (clearingFilteredPage && page > 1)
        await setPage(page - 1)
      else
        await fetchComments()
    }
    catch (error) {
      toast.error(`${operationT('update_failed')}: ${errorMessageT(error)}`)
    }
    finally {
      setModeratingIds((prev) => {
        const next = new Set(prev)
        for (const id of ids)
          next.delete(id)
        return next
      })
    }
  }

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
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <Input
            className="w-full sm:w-72"
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
          />
          <Select value={moderationFilter} onValueChange={onModerationFilterChange}>
            <SelectTrigger className="w-full sm:w-44" aria-label={t('moderation_filter_label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODERATION_FILTERS.map(filter => (
                <SelectItem key={filter} value={filter}>
                  {t(`moderation_filter_${filter}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <OrderSelector
          value={{ orderBy, desc }}
          onOrderChange={onOrderChange}
          orderBys={[...COMMENT_ORDER_BYS]}
        />
      </div>
      {activeSelectedIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('selected_count', { count: activeSelectedIds.length })}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={moderatingIds.size > 0}
              onClick={() => handleModeration(activeSelectedIds, 'approved')}
            >
              <CheckCircle2 aria-hidden className="mr-1 size-3.5" />
              {t('restore_display')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={moderatingIds.size > 0}
              onClick={() => handleModeration(activeSelectedIds, 'rejected')}
            >
              <ShieldAlert aria-hidden className="mr-1 size-3.5" />
              {t('mark_rejected')}
            </Button>
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
      <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_1px_-0.5px_rgba(0,0,0,0.035),0_3px_8px_-2px_rgba(0,0,0,0.035)] dark:shadow-none">
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
            {loading && Array.from({ length: 5 }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                <TableCell><Skeleton className="size-4" /></TableCell>
                <TableCell>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-5 w-14" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="ml-auto h-8 w-24" /></TableCell>
              </TableRow>
            ))}
            {!loading && comments.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="p-0">
                  <Empty className="py-10">
                    <EmptyDescription>{t('empty')}</EmptyDescription>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
            {!loading && comments.map(comment => (
              <CommentRow
                key={comment.id}
                comment={comment}
                selected={selectedIds.has(comment.id)}
                moderating={moderatingIds.has(comment.id)}
                onSelectChange={checked => toggleSelectOne(comment.id, checked)}
                onModerationChange={status => handleModeration([comment.id], status)}
                onDelete={handleDelete}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 py-4">
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
  moderating,
  onSelectChange,
  onModerationChange,
  onDelete,
}: {
  comment: UserComment
  selected: boolean
  moderating: boolean
  onSelectChange: (checked: boolean) => void
  onModerationChange: (status: 'approved' | 'rejected') => Promise<void>
  onDelete: (comment: UserComment) => Promise<void>
}) {
  const operationT = useOperationT()
  const t = useTranslations('Console.comments')
  const format = useFormatter()
  const isRejected = comment.moderationStatus === 'rejected'
  const isPending = comment.moderationStatus === 'pending'
  const isApproved = comment.moderationStatus === 'approved'
  const category = comment.moderationCategory && KNOWN_CATEGORIES.has(comment.moderationCategory)
    ? comment.moderationCategory
    : 'other'
  const clientInfo = [comment.browser, comment.os, comment.location && formatLocation({ location: comment.location, short: true })]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' · ')
  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className={cn(isRejected && 'bg-destructive/[0.04] hover:bg-destructive/[0.07]')}
    >
      <TableCell className="w-10">
        <Checkbox
          checked={selected}
          onCheckedChange={checked => onSelectChange(checked === true)}
          aria-label={comment.content || String(comment.id)}
        />
      </TableCell>
      <TableCell className="max-w-[28rem] whitespace-normal">
        <div className={cn('line-clamp-3 break-words', isRejected && 'text-muted-foreground')}>
          {comment.content || t('no_content')}
        </div>
        {isRejected && (comment.moderationReason || comment.moderationSource === 'ai_upstream_block') && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-destructive">
            <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
            {comment.moderationSource === 'ai_upstream_block' && (
              <span className="font-medium">{t('moderation_source_upstream_block')}</span>
            )}
            {comment.moderationReason && <span>{comment.moderationReason}</span>}
          </div>
        )}
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
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm">{comment.user?.nickname || comment.user?.username || t('unknown_user')}</span>
              {comment.user?.isAi && (
                <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px]">
                  <Bot aria-hidden className="size-2.5" />
                  AI
                </Badge>
              )}
            </div>
            {/* 邮箱仅在后端返回时展示 */}
            {comment.user?.email && <div className="truncate text-xs text-muted-foreground">{comment.user.email}</div>}
            {/* 设备与归属地：前台只在评论者选择公开时显示，后台管理员始终可见 */}
            {clientInfo && <div className="truncate text-xs text-muted-foreground" title={clientInfo}>{clientInfo}</div>}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {isRejected && (
            <Badge variant="destructive">
              {comment.moderationSource === 'manual' && (!comment.moderationCategory || comment.moderationCategory === 'other')
                ? t('moderation_manual_rejected')
                : `${comment.moderationSource === 'manual' ? t('moderation_manual_rejected') : t('moderation_rejected')} · ${t(`moderation_category_${category}`)}`}
            </Badge>
          )}
          {isPending && (
            <Badge variant="outline">{t('moderation_pending')}</Badge>
          )}
          {isApproved && (
            <Badge variant="secondary">
              {comment.moderationSource === 'manual' ? t('moderation_manual_approved') : t('moderation_approved')}
            </Badge>
          )}
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
        <div className="flex items-center justify-end gap-1.5">
          {isRejected
            ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={moderating}
                  onClick={() => onModerationChange('approved')}
                >
                  {t('restore_display')}
                </Button>
              )
            : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={moderating}
                  onClick={() => onModerationChange('rejected')}
                >
                  {t('mark_rejected')}
                </Button>
              )}
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
        </div>
      </TableCell>
    </TableRow>
  )
}
