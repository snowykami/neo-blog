'use client'

import type { Schema } from '@tiptap/pm/model'
import type { EditSessionTarget } from '@/models/edit-session'
import type { Revision, RevisionDetail, RevisionKind } from '@/models/revision'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getHTMLFromFragment } from '@tiptap/react'
import { HistoryIcon, RotateCcwIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import * as React from 'react'
import { getRevision, listRevisions } from '@/api/revision'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { formatDisplayName } from '@/utils/common/username'

const KIND_BADGE: Record<RevisionKind, string> = {
  publish: 'border-transparent bg-primary/10 text-primary',
  session: 'border-transparent bg-secondary text-secondary-foreground',
  autosave: 'text-muted-foreground',
  backup: 'border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

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
}

/** 版本历史：左侧版本列表，右侧预览所选版本，可恢复为草稿 */
export function EditorRevisionSheet({ open, onOpenChange, target, docId, schema, baseRevisionId, readOnly, onRestore }: EditorRevisionSheetProps) {
  const t = useTranslations('Console.editor.revision')
  const operationT = useOperationT()
  const errorMessageT = useErrorMessageT()
  const format = useFormatter()
  const [revisions, setRevisions] = React.useState<Revision[] | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [details, setDetails] = React.useState<Record<number, RevisionDetail>>({})
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const loadList = React.useCallback(() => {
    setListError(null)
    setRevisions(null)
    listRevisions({ target, id: docId })
      .then((res) => {
        setRevisions(res.data.revisions)
        setSelectedId(prev => prev ?? res.data.revisions[0]?.id ?? null)
      })
      .catch(error => setListError(errorMessageT(error) || operationT('fetch_failed')))
  }, [target, docId, errorMessageT, operationT])

  // 每次打开都重新获取，版本会随保存不断增加
  React.useEffect(() => {
    if (!open)
      return
    setSelectedId(null)
    setDetails({})
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
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
          {/* 版本列表 */}
          <nav aria-label={t('list_label')} className="max-h-56 overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0">
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
                {group.items.map(revision => (
                  <button
                    key={revision.id}
                    type="button"
                    aria-current={revision.id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(revision.id)}
                    className={cn(
                      'grid gap-1 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      revision.id === selectedId && 'bg-primary/10 hover:bg-primary/10',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium tabular-nums">{format.dateTime(new Date(revision.createdAt), { hour: '2-digit', minute: '2-digit' })}</span>
                      <Badge variant="outline" className={cn('px-1.5 py-0 text-[11px]', KIND_BADGE[revision.kind])}>{t(`kind_${revision.kind}`)}</Badge>
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
                ))}
              </div>
            ))}
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
              <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
                <span className="mr-auto text-xs text-muted-foreground">{t('restore_hint')}</span>
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
      </SheetContent>
    </Sheet>
  )
}
