'use client'

import type { FileModel } from '@/models/file'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { listFiles } from '@/api/file'
import { FileUploadDialogWithButton } from '@/components/common/file-uploader'
import { PaginationController } from '@/components/common/pagination'
import { formatDataSize } from '@/utils/common/datasize'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import { FileMimeIcon } from './file-icon'

export function FileSelector({
  children,
  onFilesSelected,
  limitNumber = 1,
}: {
  children?: React.ReactNode
  limitNumber?: number
  limitType?: string[] // "*" 代表所有类型, "image/*" 代表所有图片类型, "video/*" 代表所有视频类型, "audio/*" 代表所有音频类型, "text/*" 代表所有文本类型, "application/*" 代表所有应用类型
  forceLimitType?: boolean
  onFilesSelected: (files: FileModel[]) => void
}) {
  const t = useTranslations('FileSelector')
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || <Button variant="outline">{t('select_file')}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('upload_file')}</DialogTitle>
          <DialogDescription>
            {t('select_files', { n: limitNumber })}
          </DialogDescription>
        </DialogHeader>
        <FileListViewer onFilesSelected={onFilesSelected} limitNumber={limitNumber} setOpen={setOpen} />
      </DialogContent>
    </Dialog>
  )
}

export function FileListViewer({
  onFilesSelected,
  limitNumber = 1,
  setOpen,
}: {
  onFilesSelected: (files: FileModel[]) => void
  limitNumber?: number
  setOpen?: (open: boolean) => void
}) {
  const t = useTranslations('FileSelector')
  const [files, setFiles] = useState<FileModel[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [selectFilesIds, setSelectFilesIds] = useState<number[]>([])
  const [refreshKey, setRefreshKey] = useState(0) // 用于强制刷新文件列表

  useEffect(() => {
    listFiles({ page, size: 10 }).then((res) => {
      setFiles(res.data.files)
      setTotal(res.data.total)
    })
  }, [page, setFiles, setTotal, refreshKey])

  const handleSelectFile = (fileId: number) => () => {
    setSelectFilesIds((prev) => {
      if (prev.includes(fileId)) {
        return prev.filter(id => id !== fileId)
      }
      if (prev.length >= limitNumber) {
        return prev
      }
      return [...prev, fileId]
    })
  }

  const handleSubmit = () => {
    const selectedFiles = files.filter(file => selectFilesIds.includes(file.id))
    onFilesSelected(selectedFiles)
    setOpen?.(false)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <Button onClick={handleSubmit} disabled={selectFilesIds.length === 0}>
          {selectFilesIds.length === 0 ? t('select_file') : t('select_n_files', { n: selectFilesIds.length })}
        </Button>
        <FileUploadDialogWithButton onFilesUpload={() => setRefreshKey(prev => prev + 1)}>
          <Button variant="outline">{t('upload_file')}</Button>
        </FileUploadDialogWithButton>
      </div>
      <div className="my-4 space-y-2 max-h-[70vh] overflow-y-auto" role="list" tabIndex={0}>
        {files.map((file) => {
          const isDisabled = selectFilesIds.length >= limitNumber && !selectFilesIds.includes(file.id)
          return (
            <FileItem
              key={file.id}
              file={file}
              selected={selectFilesIds.includes(file.id)}
              disabled={isDisabled}
              handleSelectFile={handleSelectFile}
            />
          )
        })}
      </div>
      <PaginationController initialPage={page} onPageChange={setPage} total={total} />
    </div>
  )
}

function FileItem({
  file,
  selected,
  disabled,
  handleSelectFile,
}: {
  file: FileModel
  selected: boolean
  disabled: boolean
  handleSelectFile: (fileId: number) => () => void
}) {
  return (
    <div
      key={file.id}
      onClick={handleSelectFile(file.id)}
      className={`p-2 border rounded flex items-center gap-2 flex-shrink-0 w-full text-left transition-all duration-300
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}
              `}
      role="listitem"
      aria-disabled={disabled}
    >
      {/* 防止 Checkbox 点击冒泡到父按钮（尤其在非 disabled 情况下） */}
      <div onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          disabled={disabled}
          onCheckedChange={handleSelectFile(file.id)}
        />
      </div>

      <FileMimeIcon file={file} showImage className="w-8 h-8 rounded object-cover" />
      <div className="flex-1">
        <div className="font-medium">{file.name}</div>
        <div className="text-sm text-gray-500">
          {formatDataSize({ size: file.size })}
        </div>
      </div>
    </div>
  )
}
