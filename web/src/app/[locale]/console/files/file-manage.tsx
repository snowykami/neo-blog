'use client'
import type { FileModel } from '@/models/file'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { ArrowRightLeft, Ellipsis, LinkIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
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
import { PageSizeSelector } from '@/components/common/page-size-selector'
import { PaginationController } from '@/components/common/pagination'
import { Popconfirm } from '@/components/common/popconfirm'
import { StorageMigrationDialog } from '@/components/console/storage-migration'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useConsoleQuery } from '@/hooks/use-console-query'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useCommonT, useOperationT } from '@/hooks/use-translations'
import { useRouter } from '@/i18n/navigation'
import copyToClipboard from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { ArrangementMode, OrderBy } from '@/models/common'
import { getFileUri } from '@/utils/client/file'
import { formatDataSize } from '@/utils/common/datasize'
import { isAdmin } from '@/utils/common/permission'
import { consolePath } from '@/utils/common/route'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

// 列表为空时的固定引用：全选的 useCallback 依赖 files，避免每次渲染都换新数组
const EMPTY_FILES: FileModel[] = []

export function FileManage() {
  const t = useTranslations('Console.files')
  const commonT = useCommonT()
  const metricsT = useTranslations('Metrics')
  const operationT = useOperationT()
  const { isMobile } = useDevice()
  const { user } = useAuth()
  const router = useRouter()
  // 管理员默认查看全站文件，可切换为只看自己的；其他用户只能看到自己的文件（后端 scope=all 仅管理员可用）
  // 只有管理员可以在存储之间迁移文件
  const isAdminUser = !!user && isAdmin({ user })
  const [onlyMine, setOnlyMine] = useQueryState(
    'only_mine',
    parseAsBoolean.withDefault(false).withOptions({ history: 'replace', clearOnDefault: true }),
  )
  const scope = isAdminUser && !onlyMine ? 'all' : 'mine'
  const [migrateOpen, setMigrateOpen] = useState(false)
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

  // 列表取数：回到这个页面时先显示上次的结果，同时重新请求（见 hooks/use-console-query.ts）；写操作后缓存会被清空
  const listFilesQuery = useConsoleQuery(
    ['file/file-list', scope, page, size, orderBy, desc, debouncedQueryInput],
    async () => {
      const res = await listFiles({ page, size, orderBy, desc, query: debouncedQueryInput, scope })
      return { files: res.data.files, total: res.data.total }
    },
  )
  const files = listFilesQuery.data?.files ?? EMPTY_FILES
  const total = listFilesQuery.data?.total ?? 0
  // 首次请求完成前不显示空状态，避免闪一下「没有文件」
  const showEmpty = listFilesQuery.data !== undefined && !listFilesQuery.isPreviousData && files.length === 0
  const { refresh: refreshFiles, setData: setFileList } = listFilesQuery

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
      setFileList(prev => prev && { files: prev.files.filter(f => f.id !== fileId), total: Math.max(0, prev.total - 1) })
      setSelectedFileIds((prev) => {
        const newSet = new Set(prev)
        newSet.delete(fileId)
        return newSet
      })
    },
    [setFileList],
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
    void refreshFiles()
  }, [setPage, setOrderBy, setDesc, refreshFiles])

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
          {isAdminUser && (
            <Button variant="outline" size="sm" disabled={selectedFileIds.size === 0} onClick={() => setMigrateOpen(true)}>
              <ArrowRightLeft />
              {t('migrate_selected')}
            </Button>
          )}
          <Input
            type="search"
            placeholder={commonT('search')}
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            className="flex-1 min-w-0"
          />
          {isAdminUser && (
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="file-manage-only-mine"
                checked={onlyMine}
                onCheckedChange={(checked) => {
                  setOnlyMine(checked)
                  setPage(1)
                  // 切换范围后原先选中的文件可能不在列表里，清空以免批量操作误删看不见的文件
                  setSelectedFileIds(new Set())
                }}
              />
              <Label htmlFor="file-manage-only-mine">{t('only_mine')}</Label>
            </div>
          )}
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
      {isAdminUser && (
        <StorageMigrationDialog
          open={migrateOpen}
          onOpenChange={setMigrateOpen}
          fileIds={Array.from(selectedFileIds)}
          onStarted={() => {
            setMigrateOpen(false)
            setSelectedFileIds(new Set())
            toast(t('migration_started'), {
              action: { label: t('view_migration'), onClick: () => router.push(consolePath.storage) },
            })
          }}
        />
      )}
      <Separator className="flex-1" />
      {showEmpty && (
        <Empty className="my-4 border">
          <EmptyHeader>
            <EmptyTitle>{t('empty_title')}</EmptyTitle>
            <EmptyDescription>
              {debouncedQueryInput ? t('empty_search_description') : t('empty_description')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
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
  const format = useFormatter()
  const operationT = useOperationT()
  if (layout === ArrangementMode.Grid) {
    return (
      <div className="group">
        {/* 点击卡片任意位置切换选中（参照 file-selector），勾选框与右上角操作各自阻止冒泡 */}
        <div
          onClick={() => onSelect(!selected)}
          className={cn(
            'flex flex-col items-center px-2 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer select-none',
            selected && 'border-primary bg-accent/50',
          )}
        >
          {/* 顶部操作行：选择框 + 链接按钮 与 更多 按钮 在同一行 */}
          <div className="flex items-center justify-between w-full mb-0">
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={`${operationT('select')} ${file.name}`} />
            </div>
            {/* 菜单与删除确认通过 Portal 渲染，React 事件仍沿组件树冒泡，在这里一并拦下 */}
            <div className="flex items-center" onClick={e => e.stopPropagation()}>
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
                {format.dateTime(new Date(file.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
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
