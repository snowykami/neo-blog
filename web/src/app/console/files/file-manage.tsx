'use client'
import type { FileModel } from '@/models/file'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { useAsyncTask } from '@snowykami/use-async-task'
import { Ellipsis, LinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { batchDeleteFiles, deleteFile, listFiles } from '@/api/file'
import { ArrangementSelector } from '@/components/common/arrangement-selector'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FileMimeIcon } from '@/components/common/file-icon'
import { FileUploadDialogWithButton } from '@/components/common/file-uploader'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useDevice } from '@/contexts/device-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import copyToClipboard from '@/lib/clipboard'
import { ArrangementMode, OrderBy } from '@/models/common'
import { getFileUri } from '@/utils/client/file'
import { formatDataSize } from '@/utils/common/datasize'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export function FileManage() {
  const t = useTranslations('Console.files')
  const commonT = useCommonT()
  const metricsT = useTranslations('Metrics')
  const operationT = useOperationT()
  const { isMobile } = useDevice()
  const [files, setFiles] = useState<FileModel[]>([])
  const [total, setTotal] = useState(0)
  const [arrangement, setArrangement] = useQueryState(
    'arrangement',
    parseAsStringEnum<ArrangementMode>(Object.values(ArrangementMode))
      .withDefault(ArrangementMode.List)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [orderBy, setOrderBy] = useQueryState(
    'order_by',
    parseAsStringEnum<OrderBy>(Object.values(OrderBy))
      .withDefault(OrderBy.CreatedAt)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [desc, setDesc] = useQueryState(
    'desc',
    parseAsBoolean.withDefault(true).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const [size, setSize] = useQueryState(
    'size',
    parseAsInteger
      .withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE)
      .withOptions({ history: 'replace', clearOnDefault: true }),
  )
  // 搜索词用本地状态管理，不通过 URL
  const [queryInput, setQueryInput, debouncedQueryInput] = useDebouncedState(
    '',
    200,
  )
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set())
  // 写操作后自增，作为缓存 key 的一部分强制重新拉取列表（reset 只清空状态，不会重新请求）
  const [refreshKey, setRefreshKey] = useState(0)

  // 使用 useAsyncTask 进行文件列表搜索并缓存结果
  const listFilesTask = useAsyncTask(
    async (p: number, sz: number, ob: OrderBy, d: boolean, q: string) => {
      const res = await listFiles({ page: p, size: sz, orderBy: ob, desc: d, query: q })
      return { files: res.data.files, total: res.data.total }
    },
    {
      // 当搜索参数变化时自动执行
      immediate: true,
      dependencies: [page, size, orderBy, desc, debouncedQueryInput, refreshKey],
      getArgs: () => [page, size, orderBy, desc, debouncedQueryInput] as const,
      // 相同搜索条件在 10 秒内使用缓存，避免重复请求
      cacheTime: 10_000,
      // 根据搜索条件生成唯一的 cache key
      taskKey: (p, sz, ob, d, q) => `listFiles-${p}-${sz}-${ob}-${d}-${q}-${refreshKey}`,
      maxRetries: 1,
    },
  )

  // 更新本地状态
  useEffect(() => {
    if (listFilesTask.data) {
      setFiles(listFilesTask.data.files)
      setTotal(listFilesTask.data.total)
    }
  }, [listFilesTask.data])

  // 防抖后的搜索词真正变化时才重置分页，避免挂载时把 URL 中的页码重置为 1
  const prevQueryRef = useRef(debouncedQueryInput)
  useEffect(() => {
    if (prevQueryRef.current === debouncedQueryInput)
      return
    prevQueryRef.current = debouncedQueryInput
    setPage(1)
  }, [debouncedQueryInput, setPage])

  const onFileDelete = useCallback(
    ({ fileId }: { fileId: number }) => {
      setFiles(prev => prev.filter(f => f.id !== fileId))
      setTotal(prev => Math.max(0, prev - 1))
      setSelectedFileIds((prev) => {
        const newSet = new Set(prev)
        newSet.delete(fileId)
        return newSet
      })
    },
    [setFiles],
  )

  const onOrderChange = useCallback(
    ({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
      setOrderBy(orderBy)
      setDesc(desc)
      setPage(1)
    },
    [setOrderBy, setDesc, setPage],
  )

  const onPageChange = useCallback(
    (p: number) => {
      setPage(p)
    },
    [setPage],
  )

  const onFileIdSelect = useCallback(
    (fileId: number) => {
      return (selected: boolean) => {
        setSelectedFileIds((prev) => {
          const newSet = new Set(prev)
          if (selected) {
            newSet.add(fileId)
          }
          else {
            newSet.delete(fileId)
          }
          return newSet
        })
      }
    },
    [setSelectedFileIds],
  )

  const onAllFileSelect = useCallback(
    (selected: boolean) => {
      setSelectedFileIds((prev) => {
        const newSet = new Set(prev)
        if (selected) {
          files.forEach(file => newSet.add(file.id))
        }
        else {
          files.forEach(file => newSet.delete(file.id))
        }
        return newSet
      })
    },
    [files],
  )

  const onFilesUpload = useCallback(() => {
    setPage(1)
    setOrderBy(OrderBy.CreatedAt)
    setDesc(true)
    // 上传文件后重新拉取列表
    setRefreshKey(k => k + 1)
  }, [setPage, setOrderBy, setDesc])

  // 失败时抛出，由 ConfirmDialog 统一提示并保持打开
  const handleBatchDelete = async () => {
    await batchDeleteFiles({ ids: Array.from(selectedFileIds) })
    toast.success(operationT('delete_success'))
    Array.from(selectedFileIds).forEach(id => onFileDelete({ fileId: id }))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Checkbox
            checked={files.length !== 0 && selectedFileIds.size === files.length}
            onCheckedChange={onAllFileSelect}
            aria-label={operationT('select_all')}
            title={operationT('select_all')}
          />
          {/* 批量删除影响多个文件，使用 AlertDialog 并说明后果 */}
          <ConfirmDialog
            title={operationT('batch_delete')}
            description={t('batch_delete_description', { n: selectedFileIds.size })}
            confirmLabel={operationT('delete')}
            errorText={operationT('delete_failed')}
            confirmVariant="destructive"
            disabled={selectedFileIds.size === 0}
            onConfirm={handleBatchDelete}
          >
            <Button
              variant="destructive"
              size="sm"
              disabled={Array.from(selectedFileIds).length === 0}
            >
              {operationT('batch_delete')}
            </Button>
          </ConfirmDialog>
          <Input
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            className="flex-1 min-w-0"
          />
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <ArrangementSelector
              initialArrangement={arrangement}
              onArrangementChange={setArrangement}
            />
            <OrderSelector
              value={{ orderBy, desc }}
              onOrderChange={onOrderChange}
              orderBys={[OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.Name, OrderBy.Size]}
            />
            <FileUploadDialogWithButton onFilesUpload={onFilesUpload} />
          </div>
        </div>
      </div>
      <Separator className="flex-1" />
      {/* 列表 */}
      {arrangement === ArrangementMode.List
        && files.map(file => (
          <div key={file.id}>
            <FileItem
              file={file}
              layout={ArrangementMode.List}
              onFileDelete={onFileDelete}
              selected={selectedFileIds.has(file.id)}
              onSelect={onFileIdSelect(file.id)}
            />
            <Separator className="flex-1" />
          </div>
        ))}
      {/* 网格 */}
      {arrangement === ArrangementMode.Grid && (
        <div className={`grid gap-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {files.map(file => (
            <FileItem
              key={file.id}
              file={file}
              layout={ArrangementMode.Grid}
              onFileDelete={onFileDelete}
              selected={selectedFileIds.has(file.id)}
              onSelect={onFileIdSelect(file.id)}
            />
          ))}
        </div>
      )}
      {/* 分页 */}
      <div className="flex justify-center items-center py-4">
        {total > 0 && (
          <PaginationController
            page={page}
            onPageChange={onPageChange}
            total={total}
            pageSize={size}
          />
        )}
        <PageSizeSelector
          size={size}
          onSizeChange={(s) => {
            setSize(s)
            setPage(1)
          }}
        />
        {' '}
        {metricsT('per_page')}
      </div>
    </div>
  )
}

function FileItem({
  file,
  layout,
  onFileDelete,
  selected,
  onSelect,
}: {
  file: FileModel
  layout: ArrangementMode
  onFileDelete: ({ fileId }: { fileId: number }) => void
  selected: boolean
  onSelect: (selected: boolean) => void
}) {
  const commonT = useTranslations('Common')
  const operationT = useOperationT()
  if (layout === ArrangementMode.Grid) {
    return (
      <div className="group">
        <div className="flex flex-col items-center px-2 border rounded-lg hover:bg-accent/50 transition-colors">
          {/* 顶部操作行：选择框 + 链接按钮 与 更多 按钮 在同一行 */}
          <div className="flex items-center justify-between w-full mb-0">
            <div className="flex items-center gap-2">
              <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={`${operationT('select')} ${file.name}`} />
            </div>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => window.open(`${getFileUri(file.id)}/${file.name}`, '_blank')}
                aria-label={operationT('open')}
                title={operationT('open')}
              >
                <LinkIcon className="w-3 h-3" />
              </Button>
              <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
            </div>
          </div>

          {/* 文件预览/图标 */}
          <div>
            <FileMimeIcon file={file} showImage className="w-20 h-20 rounded object-cover mb-2" />
          </div>

          {/* 文件信息 */}
          <div className="text-center w-full">
            <div
              className="text-sm font-medium mb-1 w-full overflow-hidden whitespace-nowrap truncate"
              title={file.name}
            >
              {file.name}
            </div>
            <div className="flex flex-wrap justify-center items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {commonT('id')}
                :
                {file.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDataSize({ size: file.size })}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // List 布局
  return (
    <div>
      <div className="flex w-full items-center gap-3 py-2">
        {/* left */}
        <div className="flex items-center gap-3 w-0 flex-1 min-w-0">
          <div className="flex-shrink-0">
            <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={`${operationT('select')} ${file.name}`} />
          </div>
          <FileMimeIcon file={file} showImage className="w-10 h-10 rounded object-cover" />
          <div className="w-0 flex-1 min-w-0">
            <div
              className="text-sm font-medium overflow-hidden whitespace-nowrap truncate"
              title={file.name}
            >
              {file.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {commonT('id')}
                :
                {file.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('size')}
                :
                {formatDataSize({ size: file.size })}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('mime_type')}
                :
                {file.mimeType}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('created_at')}
                :
                {new Date(file.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => window.open(`${getFileUri(file.id)}/${file.name}`, '_blank')}
            aria-label={operationT('open')}
            title={operationT('open')}
          >
            <LinkIcon className="size-4" />
          </Button>
          <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
        </div>
      </div>
    </div>
  )
}

function FileDropdownMenu({
  file,
  onFileDelete,
}: {
  file: FileModel
  onFileDelete: ({ fileId }: { fileId: number }) => void
}) {
  const t = useTranslations('Console.files')
  const operationT = useOperationT()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { siteInfo } = useSiteInfo()

  // 失败时抛出，由 Popconfirm 统一提示并保持打开
  const handleDelete = async () => {
    await deleteFile({ id: file.id })
    toast.success(operationT('delete_success'))
    onFileDelete({ fileId: file.id })
  }

  const handleCopyLink = () => {
    copyToClipboard(
      `${siteInfo?.baseUrl ?? window.location.origin}${getFileUri(file.id)}/${file.name}`,
    )
      .then(() => {
        toast.success(operationT('copy_link_success'))
      })
      .catch(() => {
        toast.error(operationT('copy_link_failed'))
      })
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 菜单项关闭菜单后，删除确认气泡以菜单按钮为锚点就地弹出 */}
      <Popconfirm
        anchorOnly
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={operationT('delete_confirm_title', { name: file.name })}
        description={t('delete_file_description')}
        confirmText={operationT('delete')}
        errorText={operationT('delete_failed')}
        destructive
        onConfirm={handleDelete}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={operationT('more')} title={operationT('more')}>
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </Popconfirm>
      <DropdownMenuContent
        className="min-w-36"
        align="end"
        // 打开删除确认时不把焦点还给菜单按钮，焦点交给气泡
        onCloseAutoFocus={e => confirmOpen && e.preventDefault()}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
            {operationT('copy_link')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => setConfirmOpen(true)}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {operationT('delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
