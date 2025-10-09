'use client'
import type { FileModel } from '@/models/file'
import type { BaseResponseError } from '@/models/resp'
import { DropdownMenuGroup } from '@radix-ui/react-dropdown-menu'
import { Ellipsis, FileIcon, Link } from 'lucide-react'
import mime from 'mime-types'
import { useTranslations } from 'next-intl'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryState,
} from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { batchDeleteFiles, deleteFile, listFiles } from '@/api/file'
import { ArrangementSelector } from '@/components/common/arrangement-selector'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OrderSelector } from '@/components/common/orderby-selector'
import { PageSizeSelector, PaginationController } from '@/components/common/pagination'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/contexts/auth-context'
import { useDevice } from '@/contexts/device-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useCommonT, useOperationT } from '@/hooks/translations'
import { useDebouncedState } from '@/hooks/use-debounce'
import { useDoubleConfirm } from '@/hooks/use-double-confirm'
import copyToClipboard from '@/lib/clipboard'
import { ArrangementMode, OrderBy } from '@/models/common'
import { getFileUri } from '@/utils/client/file'
import { formatDataSize } from '@/utils/common/datasize'
import { mimeTypeIcons } from '@/utils/common/mimetype'
import { FileUploadDialogWithButton } from './file-uploader'

const PAGE_SIZE = 15
const MOBILE_PAGE_SIZE = 10

export function FileManage() {
  const t = useTranslations('Console.files')
  const commonT = useCommonT()
  const metricsT = useTranslations('Metrics')
  const operationT = useOperationT()
  const { user } = useAuth()
  const { isMobile } = useDevice()
  const [files, setFiles] = useState<FileModel[]>([])
  const [total, setTotal] = useState(0)
  const [arrangement, setArrangement] = useQueryState('arrangement', parseAsStringEnum<ArrangementMode>(Object.values(ArrangementMode)).withDefault(ArrangementMode.List).withOptions({ history: 'replace', clearOnDefault: true }))
  const [orderBy, setOrderBy] = useQueryState('order_by', parseAsStringEnum<OrderBy>(Object.values(OrderBy)).withDefault(OrderBy.CreatedAt).withOptions({ history: 'replace', clearOnDefault: true }))
  const [desc, setDesc] = useQueryState('desc', parseAsBoolean.withDefault(true).withOptions({ history: 'replace', clearOnDefault: true }))
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1).withOptions({ history: 'replace', clearOnDefault: true }))
  const [size, setSize] = useQueryState('size', parseAsInteger.withDefault(isMobile ? MOBILE_PAGE_SIZE : PAGE_SIZE).withOptions({ history: 'replace', clearOnDefault: true }))
  const [keywords, setKeywords] = useQueryState('keywords', parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }))
  const [keywordsInput, setKeywordsInput, debouncedKeywordsInput] = useDebouncedState(keywords, 200)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set())
  const [fileListRefreshIndex, setFileListRefreshIndex] = useState(0) // 用于强制刷新文件列表

  useEffect(() => {
    listFiles({ page, size, orderBy, desc, keywords })
      .then((res) => {
        setFiles(res.data.files)
        setTotal(res.data.total)
      })
  }, [page, orderBy, desc, size, keywords, fileListRefreshIndex])

  useEffect(() => {
    setKeywords(debouncedKeywordsInput)
  }, [debouncedKeywordsInput, setKeywords, keywords])

  const onFileDelete = useCallback(({ fileId }: { fileId: number }) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
    setSelectedFileIds((prev) => {
      const newSet = new Set(prev)
      newSet.delete(fileId)
      return newSet
    })
  }, [setFiles])

  const onOrderChange = useCallback(({ orderBy, desc }: { orderBy: OrderBy, desc: boolean }) => {
    setOrderBy(orderBy)
    setDesc(desc)
    setPage(1)
  }, [setOrderBy, setDesc, setPage])

  const onPageChange = useCallback((p: number) => {
    setPage(p)
  }, [setPage])

  const onFileIdSelect = useCallback((fileId: number) => {
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
  }, [setSelectedFileIds])

  const onAllFileSelect = useCallback((selected: boolean) => {
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
  }, [files])

  const onFilesUpload = useCallback(() => {
    setPage(1)
    setOrderBy(OrderBy.CreatedAt)
    setDesc(true)
    setFileListRefreshIndex(idx => idx + 1)
  }, [setPage, setOrderBy, setDesc])

  const handleBatchDelete = () => {
    batchDeleteFiles({ ids: Array.from(selectedFileIds) })
      .then(() => {
        toast.success(operationT('delete_success'))
        Array.from(selectedFileIds).forEach(id => onFileDelete({ fileId: id }))
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${operationT('delete_failed')}: ${error.message}`)
      })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Checkbox checked={files.length !== 0 && selectedFileIds.size === files.length} onCheckedChange={onAllFileSelect} />
          <ConfirmDialog
            description={t('will_delete_n_files', { n: selectedFileIds.size })}
            title={operationT('batch_delete')}
            confirmLabel={operationT('confirm_delete')}
            cancelLabel={operationT('cancel')}
            confirmVariant="destructive"
            disabled={selectedFileIds.size === 0}
            onConfirm={handleBatchDelete}
            closeOnConfirm={true}
          >
            <Button variant="destructive" size="sm" disabled={Array.from(selectedFileIds).length === 0}>
              {operationT('batch_delete')}
            </Button>
          </ConfirmDialog>
          <Input
            type="search"
            placeholder={commonT('search')}
            value={keywordsInput}
            onChange={e => setKeywordsInput(e.target.value)}
            className="flex-1 min-w-0"
          />
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <ArrangementSelector initialArrangement={arrangement} onArrangementChange={setArrangement} />
            <OrderSelector
              initialOrder={{ orderBy, desc }}
              onOrderChange={onOrderChange}
              orderBys={[OrderBy.CreatedAt, OrderBy.UpdatedAt, OrderBy.Name, OrderBy.Size]}
            />
            <FileUploadDialogWithButton onFilesUpload={onFilesUpload} />
          </div>
        </div>
      </div>
      <Separator className="flex-1" />
      {/* 列表 */}
      {arrangement === ArrangementMode.List && files.map(file => (
        <div key={file.id}>
          <FileItem file={file} layout={ArrangementMode.List} onFileDelete={onFileDelete} selected={selectedFileIds.has(file.id)} onSelect={onFileIdSelect(file.id)} />
          <Separator className="flex-1" />
        </div>
      ))}
      {/* 网格 */}
      {arrangement === ArrangementMode.Grid && (
        <div className={`grid gap-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
          {files.map(file => <FileItem key={file.id} file={file} layout={ArrangementMode.Grid} onFileDelete={onFileDelete} selected={selectedFileIds.has(file.id)} onSelect={onFileIdSelect(file.id)} />)}
        </div>
      )}
      {/* 分页 */}
      <div className="flex justify-center items-center py-4">
        {total > 0 && <PaginationController initialPage={page} onPageChange={onPageChange} total={total} pageSize={size} />}
        <PageSizeSelector initialSize={size} onSizeChange={(s) => { setSize(s); setPage(1) }} />
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
  if (layout === ArrangementMode.Grid) {
    return (
      <div className="group">
        <div className="flex flex-col items-center px-2 border rounded-lg hover:bg-accent/50 transition-colors">
          {/* 顶部操作行：选择框 + 链接按钮 与 更多 按钮 在同一行 */}
          <div className="flex items-center justify-between w-full mb-0">
            <div className="flex items-center gap-2">
              <Checkbox checked={selected} onCheckedChange={onSelect} />
            </div>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => window.open(`${getFileUri(file.id)}/${file.name}`, '_blank')}
              >
                <Link className="w-3 h-3" />
              </Button>
              <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
            </div>
          </div>

          {/* 文件预览/图标 */}
          <div>
            <Avatar className="h-40 w-40 rounded-sm p-1">
              <AvatarImage className="object-contain rounded-sm" src={getFileUri(file.id)} alt={file.name} />
              <AvatarFallback className="rounded-sm">
                {(() => {
                  const mimeType = file.mimeType || mime.lookup(file.name) || ''
                  const IconComponent = mimeTypeIcons[mimeType.split('/')[0] as keyof typeof mimeTypeIcons]
                  return IconComponent ? <IconComponent className="w-8 h-8" /> : <FileIcon className="w-8 h-8" />
                })()}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* 文件信息 */}
          <div className="text-center w-full">
            <div className="text-sm font-medium mb-1 w-full overflow-hidden whitespace-nowrap truncate" title={file.name}>
              {file.name}
            </div>
            <div className="flex flex-wrap justify-center items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {commonT('id')}
                :
                {' '}
                {file.id}
              </span>
              <span className="text-xs text-muted-foreground">{formatDataSize({ size: file.size })}</span>
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
            <Checkbox checked={selected} onCheckedChange={onSelect} />
          </div>
          <Avatar className="h-10 w-10 rounded-none flex-shrink-0">
            <AvatarImage className="object-contain rounded-sm" src={getFileUri(file.id)} alt={file.name} width={40} height={40} />
            <AvatarFallback className="rounded-sm">
              {(() => {
                const mimeType = file.mimeType || mime.lookup(file.name) || ''
                const IconComponent = mimeTypeIcons[mimeType.split('/')[0] as keyof typeof mimeTypeIcons]
                return IconComponent ? <IconComponent className="w-4 h-4" /> : <FileIcon className="w-4 h-4" />
              })()}
            </AvatarFallback>
          </Avatar>
          <div className="w-0 flex-1 min-w-0">
            <div className="text-sm font-medium overflow-hidden whitespace-nowrap truncate" title={file.name}>
              {file.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {commonT('id')}
                :
                {' '}
                {file.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('size')}
                :
                {' '}
                {formatDataSize({ size: file.size })}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('mime_type')}
                :
                {' '}
                {file.mimeType}
              </span>
              <span className="text-xs text-muted-foreground">
                {commonT('created_at')}
                :
                {' '}
                {new Date(file.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        {/* right */}
        <div className="flex items-center ml-auto">
          <Button variant="ghost" size="sm" onClick={() => window.open(`${getFileUri(file.id)}/${file.name}`, '_blank')}>
            <Link className="inline size-4 mr-1" />
          </Button>
          <FileDropdownMenu file={file} onFileDelete={onFileDelete} />
        </div>
      </div>
    </div>
  )
}

function FileDropdownMenu(
  {
    file,
    onFileDelete,
  }: {
    file: FileModel
    onFileDelete: ({ fileId }: { fileId: number }) => void
  },
) {
  const operationT = useOperationT()
  const { confirming: confirmingDelete, onClick: onDeleteClick, onBlur: onDeleteBlur } = useDoubleConfirm()
  const [open, setOpen] = useState(false)
  const { siteInfo } = useSiteInfo()

  const handleDelete = () => {
    deleteFile({ id: file.id })
      .then(() => {
        toast.success(operationT('delete_success'))
        onFileDelete({ fileId: file.id })
      })
      .catch((error: BaseResponseError) => {
        toast.error(`${operationT('delete_failed')}: ${error.message}`)
      })
  }

  const handleCopyLink = () => {
    copyToClipboard(
      `${siteInfo?.baseUrl ?? window.location.origin}${getFileUri(file.id)}/${file.name}`,
    ).then(() => {
      toast.success(operationT('copy_link_success'))
    }).catch(() => {
      toast.error(operationT('copy_link_failed'))
    })
    setOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o)
          onDeleteBlur()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          <Ellipsis className="w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-4" align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
            {operationT('copy_link')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={(e) => {
              if (!confirmingDelete) {
                e.preventDefault()
                onDeleteClick(() => handleDelete())
              }
              else {
                onDeleteClick(() => handleDelete())
              }
            }}
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
          >
            {confirmingDelete ? operationT('confirm_delete') : operationT('delete')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
