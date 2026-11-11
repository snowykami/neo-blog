'use client'

import type { MusicLyricAnnotationBatchStatus, MusicLyricAnnotationListItem } from '@/api/music'
import type { BaseResponseError } from '@/models/resp'
import { Eye, Music2Icon, PencilLine, RefreshCw, Trash2, X } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { batchDeleteLyricAnnotations, cancelLyricAnnotationBatch, getLyricAnnotationBatch, listLyricAnnotations, startLyricAnnotationBatch } from '@/api/music'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useErrorBodyT, useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { Link, useRouter } from '@/i18n/navigation'
import { consolePath } from '@/utils/common/route'

// 批量重新生成进行中时查询进度的间隔
const BATCH_POLL_MS = 3000

type BatchItem = MusicLyricAnnotationBatchStatus['items'][number]

/**
 * 后台歌词特效列表（分页，后端合并歌单与已有标注）：博客歌单中的歌曲与已有标注的歌曲（如文章引用的、已移出歌单的），
 * 显示标注状态（未生成 / AI 生成 / 手动编辑过 / 已不在歌单）；点击进入编辑器。不在列表里的歌曲（文章引用、还没生成标注）可以按网易云歌曲 ID 打开。
 * 可以勾选多首（可跨页）批量删除特效或让 AI 重新生成：重新生成在后端逐首执行，进度保存在共享状态中，关闭页面不影响，回来时继续显示
 */
export function LyricEffectManage() {
  const t = useTranslations('Console.lyric_effects')
  const metricsT = useTranslations('Metrics')
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const router = useRouter()
  const [query, setQuery] = useQueryState('q', { history: 'replace', defaultValue: '', clearOnDefault: true })
  const [keyword, setKeyword] = useState(query)
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }))
  const [size, setSize] = useState(20)
  const [openId, setOpenId] = useState('')
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [overwriteEdited, setOverwriteEdited] = useState(false)
  const [batch, setBatch] = useState<MusicLyricAnnotationBatchStatus | null>(null)
  // 收起的已结束任务（按任务 ID），进行中的任务始终显示
  const [dismissedBatch, setDismissedBatch] = useState('')
  // 每分钟更新一次的当前时间：整个列表共用一个定时器
  const now = useNow({ updateInterval: 60_000 })

  // 回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const listQuery = useConsoleQuery(
    ['music/lyric/annotations', page, size, query],
    () => listLyricAnnotations({ page, size, q: query || undefined }),
    { onError: error => toast.error(`${operationT('fetch_failed')}: ${errorMessageT(error as BaseResponseError)}`) },
  )
  const rows = useMemo(() => (listQuery.error ? [] : (listQuery.data?.items ?? [])), [listQuery.data, listQuery.error])
  const total = listQuery.error ? 0 : (listQuery.data?.total ?? 0)
  const loading = listQuery.loading && !listQuery.data
  const reloadList = listQuery.refresh

  useEffect(() => {
    getLyricAnnotationBatch().then(setBatch, () => {})
  }, [])

  // 输入停顿后再搜索
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keyword.trim() !== query) {
        void setQuery(keyword.trim())
        void setPage(1)
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [keyword, query, setPage, setQuery])

  // 批量重新生成进行中：定时查询进度，结束时刷新列表中的标注状态
  const batchRunning = batch?.state === 'running'
  useEffect(() => {
    if (!batchRunning)
      return
    let stopped = false
    const timer = window.setInterval(async () => {
      const next = await getLyricAnnotationBatch().catch(() => undefined)
      if (stopped || next === undefined)
        return
      setBatch(next)
      if (next?.state !== 'running')
        void reloadList()
    }, BATCH_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [batchRunning, reloadList])

  const batchItems = useMemo(() => new Map((batch?.items ?? []).map(item => [item.songId, item])), [batch])

  // 全选只针对当前页；已选的歌曲跨页保留
  const rowIds = rows.map(row => row.songId)
  const allSelected = rowIds.length > 0 && rowIds.every(id => selected.has(id))
  const toggle = (ids: number[], checked: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const id of ids) {
      if (checked)
        next.add(id)
      else
        next.delete(id)
    }
    return next
  })

  const startRegenerate = async () => {
    const status = await startLyricAnnotationBatch([...selected], overwriteEdited)
    setBatch(status)
    setSelected(new Set())
    toast.success(t('batch_started', { count: status.total }))
  }

  const deleteSelected = async () => {
    const { songs } = await batchDeleteLyricAnnotations([...selected])
    setSelected(new Set())
    toast.success(songs > 0 ? t('batch_deleted', { count: songs }) : t('batch_deleted_none'))
    await reloadList()
  }

  const cancelBatch = async () => {
    try {
      setBatch(await cancelLyricAnnotationBatch())
    }
    catch (error) {
      toast.error(`${operationT('operation_failed')}: ${errorMessageT(error as BaseResponseError)}`)
    }
  }

  const openById = (event: React.FormEvent) => {
    event.preventDefault()
    const id = Number(openId.trim())
    if (Number.isInteger(id) && id > 0)
      router.push(`${consolePath.lyricEffect}/${id}`)
  }

  const changeSize = (nextSize: number) => {
    setSize(nextSize)
    void setPage(1)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          placeholder={t('search')}
          aria-label={t('search')}
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          className="max-w-sm"
        />
        <form onSubmit={openById} className="flex gap-2">
          <Input
            inputMode="numeric"
            placeholder={t('open_by_id')}
            value={openId}
            onChange={event => setOpenId(event.target.value)}
            className="w-44"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!/^\d+$/.test(openId.trim())}>{t('open')}</Button>
        </form>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{t('description')}</p>
      {batch && (batchRunning || batch.id !== dismissedBatch) && (
        <LyricEffectBatchProgress batch={batch} onCancel={cancelBatch} onDismiss={() => setDismissedBatch(batch.id)} />
      )}
      <div className="flex min-h-11 flex-wrap items-center gap-3 py-2">
        <Label className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          <Checkbox
            checked={allSelected}
            disabled={loading || rowIds.length === 0}
            onCheckedChange={checked => toggle(rowIds, checked === true)}
          />
          {t('select_all')}
        </Label>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums">{t('selected', { count: selected.size })}</span>
            <Button size="sm" variant="outline" disabled={batchRunning} title={batchRunning ? t('batch_busy') : undefined} onClick={() => setRegenerateOpen(true)}>
              <RefreshCw />
              {t('batch_regenerate')}
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              {t('batch_delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X />
              {t('clear_selection')}
            </Button>
          </div>
        )}
      </div>
      <Separator />
      {!loading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</div>}
      {rows.map(row => (
        <div key={row.songId}>
          <LyricEffectItem
            row={row}
            now={now}
            selected={selected.has(row.songId)}
            onSelectedChange={checked => toggle([row.songId], checked)}
            batchItem={batchItems.get(row.songId)}
          />
          <Separator />
        </div>
      ))}
      <div className="flex items-center justify-center py-4">
        {total > 0 && <PaginationController page={page} onPageChange={next => void setPage(next)} total={total} pageSize={size} />}
        <PageSizeSelector size={size} onSizeChange={changeSize} />
        {' '}
        {metricsT('per_page')}
      </div>

      {regenerateOpen && (
        <ConfirmDialog
          open
          title={t('batch_regenerate_title', { count: selected.size })}
          description={t('batch_regenerate_description')}
          content={(
            <Label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox className="mt-0.5" checked={overwriteEdited} onCheckedChange={checked => setOverwriteEdited(checked === true)} />
              <span className="grid gap-0.5">
                {t('batch_overwrite_edited')}
                <span className="text-xs text-muted-foreground">{t('batch_overwrite_edited_hint')}</span>
              </span>
            </Label>
          )}
          confirmLabel={t('batch_regenerate')}
          confirmVariant="default"
          errorText={operationT('operation_failed')}
          onOpenChange={setRegenerateOpen}
          onConfirm={startRegenerate}
        />
      )}
      {deleteOpen && (
        <ConfirmDialog
          open
          title={t('batch_delete_title', { count: selected.size })}
          description={t('batch_delete_description')}
          confirmLabel={t('batch_delete')}
          errorText={operationT('operation_failed')}
          onOpenChange={setDeleteOpen}
          onConfirm={deleteSelected}
        />
      )}
    </div>
  )
}

/** 批量重新生成的进度：完成 / 跳过 / 失败的数量与进度条，进行中可以取消，结束后可以收起 */
function LyricEffectBatchProgress({ batch, onCancel, onDismiss }: { batch: MusicLyricAnnotationBatchStatus, onCancel: () => void, onDismiss: () => void }) {
  const t = useTranslations('Console.lyric_effects')
  const format = useFormatter()
  const finished = batch.done + batch.skipped + batch.failed
  const running = batch.state === 'running'
  return (
    <div className="mb-3 grid gap-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('batch_progress_title')}</span>
        <Badge variant={running ? 'default' : 'secondary'}>{t(`batch_state_${batch.state}`)}</Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('batch_counts', { done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total })}
        </span>
        <span className="ml-auto flex gap-2">
          {running && (
            <Button size="sm" variant="outline" disabled={batch.canceling} onClick={onCancel}>
              {t('batch_cancel')}
            </Button>
          )}
          {!running && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              {t('batch_dismiss')}
            </Button>
          )}
        </span>
      </div>
      <Progress value={batch.total > 0 ? (finished / batch.total) * 100 : 0} aria-label={t('batch_progress_title')} />
      <p className="text-xs text-muted-foreground">
        {batch.canceling
          ? t('batch_canceling')
          : batch.interrupted
            ? t('batch_interrupted')
            : batch.finishedAt
              ? t('batch_finished_at', { time: format.dateTime(new Date(batch.finishedAt), { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('batch_running_hint')}
      </p>
    </div>
  )
}

/** 一首歌在批量重新生成中的状态；跳过或失败时悬停显示原因 */
function BatchItemBadge({ item }: { item: BatchItem }) {
  const t = useTranslations('Console.lyric_effects')
  const errorBodyT = useErrorBodyT()
  const reason = item.reason === 'edited'
    ? t('batch_reason_edited')
    : item.reason === 'deleted'
      ? t('batch_reason_deleted')
      : item.reason ? errorBodyT({ reason: '', code: item.reason }) : undefined
  const className = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-sky-100 text-sky-800',
    done: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    skipped: 'bg-amber-100 text-amber-800',
  }[item.status]
  return (
    // 原因可能较长：允许折行，不把窄屏的行撑宽
    <Badge className={`${className} h-auto max-w-full whitespace-normal text-left wrap-anywhere`} title={reason}>
      {reason ? t('batch_item_with_reason', { status: t(`batch_item_${item.status}`), reason }) : t(`batch_item_${item.status}`)}
    </Badge>
  )
}

function LyricEffectItem({ row, now, selected, onSelectedChange, batchItem }: {
  row: MusicLyricAnnotationListItem
  now: Date
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  batchItem?: BatchItem
}) {
  const t = useTranslations('Console.lyric_effects')
  const operationT = useOperationT()
  const format = useFormatter()
  const { summary, track } = row
  const editUrl = `${consolePath.lyricEffect}/${row.songId}`
  return (
    <div className="flex w-full items-center gap-3 py-3">
      <Checkbox
        checked={selected}
        onCheckedChange={checked => onSelectedChange(checked === true)}
        aria-label={t('select_song', { name: track?.name ?? String(row.songId) })}
      />
      <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted">
        {track?.albumPic
          ? <SafeImage src={track.albumPic} alt="" fill sizes="44px" className="object-cover" />
          : <Music2Icon className="absolute inset-0 m-auto size-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0">
        <Link href={editUrl} className="block truncate text-sm font-medium hover:underline">
          {track?.name ?? t('unknown_song', { id: row.songId })}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {track && <span className="truncate text-xs text-muted-foreground">{track.artists.join(' / ')}</span>}
          <Badge variant="secondary">
            ID:
            {row.songId}
          </Badge>
          {row.orphaned && <Badge className="bg-amber-100 text-amber-800" title={t('status_orphaned_hint')}>{t('status_orphaned')}</Badge>}
          {!summary && <Badge variant="outline">{t('status_none')}</Badge>}
          {summary && !summary.editedAt && <Badge className="bg-violet-100 text-violet-800">{t('status_ai')}</Badge>}
          {summary?.editedAt && <Badge className="bg-green-100 text-green-800">{t('status_edited')}</Badge>}
          {/* 全站歌词版本已更换（spec 7.2o）：显示的标注属于旧版本，或有旧版本的手动编辑不再显示 */}
          {summary?.outdated && <Badge className="bg-amber-100 text-amber-800" title={t('status_outdated_hint')}>{t('status_outdated')}</Badge>}
          {summary?.outdatedEditedAt && <Badge className="bg-amber-100 text-amber-800" title={t('status_outdated_edit_hint')}>{t('status_outdated_edit')}</Badge>}
          {summary && <Badge variant="outline">{t('phrase_count', { count: summary.phrases })}</Badge>}
          {batchItem && <BatchItemBadge item={batchItem} />}
          {summary && (
            <span className="text-xs text-muted-foreground">
              {/* 刚保存的时间可能晚于每分钟更新一次的 now，按「刚刚」显示 */}
              {format.relativeTime(new Date(summary.editedAt ?? summary.generatedAt), Math.max(now.getTime(), Date.parse(summary.editedAt ?? summary.generatedAt)))}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={`/music?id=${row.songId}`} target="_blank" rel="noreferrer" aria-label={t('preview')} title={t('preview')}>
            <Eye className="size-4" />
          </a>
        </Button>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={editUrl} aria-label={operationT('edit')} title={operationT('edit')}>
            <PencilLine className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
