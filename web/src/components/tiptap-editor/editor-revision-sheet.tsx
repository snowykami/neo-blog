'use client'

import type { Schema } from '@tiptap/pm/model'
import type { EditSessionTarget } from '@/models/edit-session'
import type { Revision, RevisionDetail, RevisionKind } from '@/models/revision'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/react'
import { HistoryIcon, ListChecksIcon, LockIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { getRevision, listRevisions } from '@/api/revision'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { formatDisplayName } from '@/utils/common/username'

const KIND_BADGE: Record<RevisionKind, string> = {
  publish: 'border-transparent bg-primary/10 text-primary',
  session: 'border-transparent bg-secondary text-secondary-foreground',
  autosave: 'text-muted-foreground',
  backup: 'border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

// 每次加载的版本数（接口上限）；默认保留上限内的版本一次即可加载完
const PAGE_SIZE = 100

/** 用编辑器的 schema 重新解析版本正文：只保留编辑器认识的节点与属性，样式与编辑器一致 */
function sanitizeContent(schema: Schema, html: string) {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  return getHTMLFromFragment(PMDOMParser.fromSchema(schema).parse(body).content, schema)
}

export interface EditorRevisionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: EditSessionTarget
  docId: number
  schema: Schema
  // 打开编辑器时的版本，在列表中标出
  baseRevisionId: number | null
  readOnly: boolean
  onRestore: (revisionId: number) => Promise<void>
  // 删除版本（单个或批量）；当前发布的版本、最新版本与编辑起点由服务端标记为受保护，不能删除
  onDelete: (revisionIds: number[]) => Promise<void>
}

/** 版本历史：左侧版本列表，右侧预览所选版本，可恢复为草稿；可删除单个版本或多选批量删除 */
export function EditorRevisionSheet({ open, onOpenChange, target, docId, schema, baseRevisionId, readOnly, onRestore, onDelete }: EditorRevisionSheetProps) {
  const t = useTranslations('Console.editor.revision')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const format = useFormatter()
  const [revisions, setRevisions] = React.useState<Revision[] | null>(null)
  const [total, setTotal] = React.useState(0)
  const [maxKeep, setMaxKeep] = React.useState<number | null>(null)
  const [page, setPage] = React.useState(1)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [listError, setListError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [details, setDetails] = React.useState<Record<number, RevisionDetail>>({})
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  // 多选删除：选择模式、已勾选的版本、Shift 连选的起点；待确认删除的版本
  const [selecting, setSelecting] = React.useState(false)
  const [checkedIds, setCheckedIds] = React.useState<Set<number>>(() => new Set())
  const anchorIdRef = React.useRef<number | null>(null)
  const [deleteIds, setDeleteIds] = React.useState<number[] | null>(null)

  // 重新获取第一页；保留仍存在的所选版本，否则选中最新的版本
  const loadList = React.useCallback(() => {
    setListError(null)
    setRevisions(null)
    setPage(1)
    listRevisions({ target, id: docId, size: PAGE_SIZE })
      .then((res) => {
        const list = res.data.revisions
        setRevisions(list)
        setTotal(res.data.total)
        setMaxKeep(res.data.maxKeep)
        setSelectedId(prev => (prev && list.some(r => r.id === prev) ? prev : list[0]?.id ?? null))
      })
      .catch(error => setListError(errorMessageT(error) || operationT('fetch_failed')))
  }, [target, docId, errorMessageT, operationT])

  const loadMore = () => {
    setLoadingMore(true)
    listRevisions({ target, id: docId, page: page + 1, size: PAGE_SIZE })
      .then((res) => {
        setPage(page + 1)
        setTotal(res.data.total)
        // 期间新增的版本会让分页后移，按 ID 去重
        setRevisions(prev => [...(prev ?? []), ...res.data.revisions.filter(r => !prev?.some(item => item.id === r.id))])
      })
      .catch(error => toast.error(errorMessageT(error) || operationT('fetch_failed')))
      .finally(() => setLoadingMore(false))
  }

  // 每次打开都重新获取，版本会随保存不断增加
  React.useEffect(() => {
    if (!open)
      return
    setSelectedId(null)
    setDetails({})
    setSelecting(false)
    setCheckedIds(new Set())
    loadList()
  }, [open, loadList])

  const detail = selectedId ? details[selectedId] : undefined
  React.useEffect(() => {
    if (!open || !selectedId || details[selectedId])
      return
    let cancelled = false
    setDetailError(null)
    getRevision({ target, id: docId, revisionId: selectedId })
      .then((res) => {
        if (!cancelled)
          setDetails(prev => ({ ...prev, [selectedId]: res.data }))
      })
      .catch((error) => {
        if (!cancelled)
          setDetailError(errorMessageT(error) || operationT('fetch_failed'))
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedId, details, target, docId, errorMessageT, operationT])

  const previewHtml = React.useMemo(() => (detail ? sanitizeContent(schema, detail.content) : ''), [detail, schema])
  const selectedProtected = revisions?.find(r => r.id === selectedId)?.protected

  // 可删除的版本（按列表顺序），全选与 Shift 连选只作用于这些版本
  const deletable = React.useMemo(() => (revisions ?? []).filter(r => !r.protected), [revisions])
  const canSelect = selecting && !readOnly
  const allChecked = deletable.length > 0 && deletable.every(r => checkedIds.has(r.id))

  const toggleChecked = (revisionId: number, shiftKey: boolean) => {
    const checked = !checkedIds.has(revisionId)
    let range = [revisionId]
    const from = deletable.findIndex(r => r.id === anchorIdRef.current)
    const to = deletable.findIndex(r => r.id === revisionId)
    if (shiftKey && from !== -1 && to !== -1)
      range = deletable.slice(Math.min(from, to), Math.max(from, to) + 1).map(r => r.id)
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const id of range) {
        if (checked)
          next.add(id)
        else
          next.delete(id)
      }
      return next
    })
    anchorIdRef.current = revisionId
  }

  const exitSelecting = () => {
    setSelecting(false)
    setCheckedIds(new Set())
    anchorIdRef.current = null
  }

  // 按日期分组
  const groups = React.useMemo(() => {
    const result: { day: string, items: Revision[] }[] = []
    for (const revision of revisions ?? []) {
      const day = format.dateTime(new Date(revision.createdAt), { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
      const last = result.at(-1)
      if (last?.day === day)
        last.items.push(revision)
      else
        result.push({ day, items: [revision] })
    }
    return result
  }, [revisions, format])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4" aria-hidden />
            {t('title')}
          </SheetTitle>
          <SheetDescription>
            {t('description')}
            {maxKeep !== null && <span className="block">{t('retention_hint', { count: maxKeep })}</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
          {/* 版本列表 */}
          <nav aria-label={t('list_label')} className="max-h-56 overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0">
            {/* 工具栏：版本数与进入选择模式；选择模式下全选、批量删除 */}
            {revisions && revisions.length > 0 && (
              <div className="sticky -top-2 z-10 -mx-2 -mt-2 mb-1 flex min-h-11 items-center gap-2 border-b bg-background px-3 py-1.5">
                {canSelect
                  ? (
                      <>
                        <Checkbox
                          checked={allChecked || (checkedIds.size > 0 && 'indeterminate')}
                          disabled={deletable.length === 0}
                          onCheckedChange={() => setCheckedIds(allChecked ? new Set() : new Set(deletable.map(r => r.id)))}
                          aria-label={t('select_all')}
                        />
                        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground tabular-nums">{t('selected_count', { count: checkedIds.size })}</span>
                        <Button size="sm" variant="destructive" disabled={checkedIds.size === 0} onClick={() => setDeleteIds([...checkedIds])}>
                          <Trash2Icon aria-hidden />
                          {t('delete')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={exitSelecting}>{t('cancel_select')}</Button>
                      </>
                    )
                  : (
                      <>
                        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground tabular-nums">{t('total', { count: total })}</span>
                        <Button size="sm" variant="ghost" disabled={readOnly || deletable.length === 0} onClick={() => setSelecting(true)}>
                          <ListChecksIcon aria-hidden />
                          {t('select')}
                        </Button>
                      </>
                    )}
              </div>
            )}
            {listError && (
              <Alert variant="destructive" className="m-1">
                <AlertDescription className="grid gap-2">
                  {listError}
                  <Button size="sm" variant="outline" onClick={loadList}>{t('retry')}</Button>
                </AlertDescription>
              </Alert>
            )}
            {!listError && !revisions && (
              <div className="grid gap-2 p-1">
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
              </div>
            )}
            {revisions?.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('empty')}</p>}
            {groups.map(group => (
              <div key={group.day} className="grid gap-0.5 pb-2">
                <div className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">{group.day}</div>
                {group.items.map((revision) => {
                  const time = format.dateTime(new Date(revision.createdAt), { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={revision.id} className="flex items-start gap-1">
                      {/* 选择模式：可删除的版本显示复选框（Shift 连选），受保护的版本显示锁并说明原因 */}
                      {canSelect && (
                        <div className="flex h-9 w-6 shrink-0 items-center justify-center">
                          {revision.protected
                            ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span role="img" tabIndex={0} aria-label={t(`protected_${revision.protected}`)} className="text-muted-foreground">
                                      <LockIcon className="size-3.5" aria-hidden />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t(`protected_${revision.protected}`)}</TooltipContent>
                                </Tooltip>
                              )
                            : (
                                <Checkbox
                                  checked={checkedIds.has(revision.id)}
                                  onClick={event => toggleChecked(revision.id, event.shiftKey)}
                                  aria-label={t('select_revision', { time })}
                                />
                              )}
                        </div>
                      )}
                      <button
                        type="button"
                        aria-current={revision.id === selectedId ? 'true' : undefined}
                        onClick={() => setSelectedId(revision.id)}
                        className={cn(
                          'grid min-w-0 flex-1 gap-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          revision.id === selectedId && 'bg-primary/10 hover:bg-primary/10',
                        )}
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium tabular-nums">{time}</span>
                          <Badge variant="outline" className={cn('px-1.5 py-0 text-[11px]', KIND_BADGE[revision.kind])}>{t(`kind_${revision.kind}`)}</Badge>
                          {revision.protected === 'published' && <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{t('published_marker')}</Badge>}
                          {revision.id === baseRevisionId && <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{t('base_marker')}</Badge>}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatDisplayName(revision.user)}
                          {' · '}
                          {t('words', { count: revision.wordCount })}
                        </span>
                        {/* 外部 AI 工具通过 API Token 写入的版本 */}
                        {revision.apiTokenName && (
                          <span className="truncate text-xs text-muted-foreground">{t('via_api_token', { name: revision.apiTokenName })}</span>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
            {revisions && revisions.length < total && (
              <Button size="sm" variant="ghost" className="w-full" disabled={loadingMore} onClick={loadMore}>
                {loadingMore && <Spinner />}
                {t('load_more', { count: total - revisions.length })}
              </Button>
            )}
          </nav>

          {/* 版本预览 */}
          <section aria-label={t('preview_label')} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {!selectedId && revisions && revisions.length > 0 && <p className="text-sm text-muted-foreground">{t('select_hint')}</p>}
              {selectedId && detailError && <Alert variant="destructive"><AlertDescription>{detailError}</AlertDescription></Alert>}
              {selectedId && !detail && !detailError && (
                <div className="grid gap-3">
                  <Skeleton className="h-7 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              )}
              {detail && (
                <article className="grid gap-3">
                  <h2 className="text-2xl font-bold">{detail.meta.title || detail.title}</h2>
                  {detail.meta.description && <p className="text-sm text-muted-foreground">{detail.meta.description}</p>}
                  <div
                    className="neo-editor-content prose max-w-none dark:prose-invert"
                    // 正文已按编辑器 schema 重新解析，只包含编辑器认识的节点与属性
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </article>
              )}
            </div>
            {detail && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-3">
                <div className="mr-auto grid gap-0.5 text-xs text-muted-foreground">
                  <span>{t('restore_hint')}</span>
                  {selectedProtected && <span>{t(`protected_${selectedProtected}`)}</span>}
                </div>
                <Button size="sm" variant="outline" disabled={readOnly || Boolean(selectedProtected)} onClick={() => setDeleteIds([detail.id])}>
                  <Trash2Icon aria-hidden />
                  {t('delete')}
                </Button>
                <Button size="sm" disabled={readOnly} onClick={() => setConfirmOpen(true)}>
                  <RotateCcwIcon aria-hidden />
                  {t('restore')}
                </Button>
              </div>
            )}
          </section>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('restore_title')}
          description={t('restore_description')}
          confirmLabel={t('restore')}
          confirmVariant="default"
          errorText={t('restore_failed')}
          onConfirm={async () => {
            if (!selectedId)
              return
            await onRestore(selectedId)
            onOpenChange(false)
          }}
        />
        <ConfirmDialog
          open={deleteIds !== null}
          onOpenChange={open => !open && setDeleteIds(null)}
          title={t('delete_title', { count: deleteIds?.length ?? 0 })}
          description={t('delete_description')}
          confirmLabel={t('delete')}
          errorText={t('delete_failed')}
          onConfirm={async () => {
            if (!deleteIds)
              return
            await onDelete(deleteIds)
            toast.success(t('deleted', { count: deleteIds.length }))
            exitSelecting()
            if (selectedId && deleteIds.includes(selectedId))
              setSelectedId(null)
            setDetails((prev) => {
              const next = { ...prev }
              for (const id of deleteIds)
                delete next[id]
              return next
            })
            // 重新获取列表：删除后分页会前移，受保护的版本也以服务端为准
            loadList()
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
