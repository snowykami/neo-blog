'use client'

import type { PickedAsset } from './utils'
import type { FileTypeFilter } from '@/api/file'
import type { FileModel } from '@/models/file'
import { CheckIcon, FolderOpenIcon, RotateCwIcon, SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { listFiles } from '@/api/file'
import { SafeImage } from '@/components/common/safe-image'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useErrorMessageT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { mimeTypeIcons } from '@/utils/client/file'
import { formatDataSize } from '@/utils/common/datasize'
import { isImageAsset, matchAccept, toPickedAsset } from './utils'

const PAGE_SIZE = 24
const TYPE_FILTERS: FileTypeFilter[] = ['image', 'video', 'audio', 'other']

export type AssetScope = 'mine' | 'all'

/**
 * 分页加载资产列表：筛选条件或 refreshKey 变化时从第一页重新加载，loadMore 追加下一页
 */
function useAssetList({ query, type, scope, refreshKey }: { query: string, type?: FileTypeFilter, scope: AssetScope, refreshKey: number }) {
  const errorMessageT = useErrorMessageT()
  const [state, setState] = React.useState<{ files: FileModel[], total: number, page: number, loading: boolean, error: string | null }>({
    files: [],
    total: 0,
    page: 1,
    loading: true,
    error: null,
  })
  const [page, setPage] = React.useState(1)
  const [retryKey, setRetryKey] = React.useState(0)
  const filterKey = `${query}|${type ?? ''}|${scope}|${refreshKey}`
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  // 筛选条件变化时回到第一页（渲染期间调整状态，避免额外一次请求）
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  React.useEffect(() => {
    let cancelled = false
    setState(prev => ({ ...prev, loading: true, error: null }))
    listFiles({ page, size: PAGE_SIZE, query: query || undefined, type, scope, orderBy: 'created_at', desc: true })
      .then((res) => {
        if (cancelled)
          return
        setState(prev => ({
          files: page === 1 ? res.data.files : [...prev.files, ...res.data.files.filter(file => !prev.files.some(item => item.id === file.id))],
          total: res.data.total,
          page,
          loading: false,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState(prev => ({ ...prev, loading: false, error: errorMessageT(error) }))
      })
    return () => {
      cancelled = true
    }
  }, [page, query, type, scope, refreshKey, retryKey, errorMessageT])

  return {
    ...state,
    // 正在请求的页码；与 state.page（最后成功加载的页）区分，筛选变化后据此显示骨架屏
    requestedPage: page,
    hasMore: state.files.length < state.total,
    loadMore: () => setPage(state.page + 1),
    retry: () => setRetryKey(key => key + 1),
  }
}

export function AssetLibrary({
  accept,
  lockedType,
  canViewAll,
  refreshKey,
  selected,
  onToggle,
  onConfirm,
}: {
  accept?: string
  lockedType?: FileTypeFilter
  canViewAll: boolean
  refreshKey: number
  selected: PickedAsset[]
  onToggle: (asset: PickedAsset) => void
  onConfirm: (asset: PickedAsset) => void
}) {
  const t = useTranslations('AssetPicker')
  const [keyword, setKeyword] = React.useState('')
  const query = useDebouncedValue(keyword.trim(), 300)
  const [typeFilter, setTypeFilter] = React.useState<FileTypeFilter | 'all'>('all')
  const [scope, setScope] = React.useState<AssetScope>('mine')
  const type = lockedType ?? (typeFilter === 'all' ? undefined : typeFilter)
  const { files, total, loading, error, hasMore, requestedPage, loadMore, retry } = useAssetList({ query, type, scope, refreshKey })
  const initialLoading = loading && requestedPage === 1

  return (
    <div className="grid min-h-0 gap-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-40 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            className="pl-8"
          />
        </div>
        {!lockedType && (
          <Select value={typeFilter} onValueChange={value => setTypeFilter(value as FileTypeFilter | 'all')}>
            <SelectTrigger className="w-28" aria-label={t('type_filter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('type_all')}</SelectItem>
              {TYPE_FILTERS.map(item => <SelectItem key={item} value={item}>{t(`type_${item}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {/* 只有管理员可以查看全部用户的文件，后端同样会校验 */}
        {canViewAll && (
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            value={scope}
            onValueChange={value => value && setScope(value as AssetScope)}
            aria-label={t('scope')}
          >
            <ToggleGroupItem value="mine" className="px-3">{t('scope_mine')}</ToggleGroupItem>
            <ToggleGroupItem value="all" className="px-3">{t('scope_all')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      <div className="max-h-[52dvh] min-h-48 overflow-y-auto overscroll-contain rounded-lg sm:max-h-[min(56vh,520px)]">
        {error && files.length === 0
          ? (
              <Alert variant="destructive">
                <AlertTitle>{t('load_error')}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>{error}</span>
                  <Button type="button" size="sm" variant="outline" onClick={retry}>
                    <RotateCwIcon />
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )
          : initialLoading
            ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
                </div>
              )
            : files.length === 0
              ? (
                  <Empty className="border border-dashed">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><FolderOpenIcon /></EmptyMedia>
                      <EmptyTitle>{query ? t('empty_search') : t('empty_title')}</EmptyTitle>
                      <EmptyDescription>{t('empty_description')}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )
              : (
                  <div className="grid gap-3">
                    <div role="listbox" aria-multiselectable className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                      {files.map((file) => {
                        const asset = toPickedAsset(file)
                        return (
                          <AssetTile
                            key={file.id}
                            asset={asset}
                            selected={selected.some(item => item.id === file.id)}
                            disabled={!matchAccept(asset, accept)}
                            onToggle={() => onToggle(asset)}
                            onConfirm={() => onConfirm(asset)}
                          />
                        )
                      })}
                    </div>
                    <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                      <span>{t('loaded_count', { count: files.length, total })}</span>
                      {hasMore && (
                        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={loadMore}>
                          {loading && <Spinner />}
                          {t('load_more')}
                        </Button>
                      )}
                      {error && <span className="text-destructive">{error}</span>}
                    </div>
                  </div>
                )}
      </div>
    </div>
  )
}

function AssetTile({ asset, selected, disabled, onToggle, onConfirm }: {
  asset: PickedAsset
  selected: boolean
  disabled: boolean
  onToggle: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('AssetPicker')
  const kind = asset.mimeType.split('/')[0]
  const Icon = mimeTypeIcons[kind as keyof typeof mimeTypeIcons] ?? mimeTypeIcons.file
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      title={disabled ? t('type_not_allowed') : asset.name}
      onClick={onToggle}
      onDoubleClick={onConfirm}
      className={cn(
        'group relative grid gap-1 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40',
        selected && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <span className={cn('relative grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/60 text-muted-foreground', selected && 'border-primary ring-2 ring-primary')}>
        {isImageAsset(asset)
          ? (
              <SafeImage
                src={asset.url}
                alt={asset.name}
                fill
                sizes="160px"
                unoptimized={asset.mimeType === 'image/svg+xml'}
                className="object-cover"
              />
            )
          : <Icon className="size-8" />}
        {selected && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow">
            <CheckIcon className="size-3.5" />
          </span>
        )}
      </span>
      <span className="truncate px-0.5 text-xs text-foreground/85">{asset.name || `#${asset.id}`}</span>
      <span className="px-0.5 text-[11px] text-muted-foreground">{formatDataSize({ size: asset.size })}</span>
    </button>
  )
}
