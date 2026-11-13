'use client'

import type { ChangeEvent } from 'react'
import type { CompressPreview } from '@/hooks/use-image-compress'
import { CircleXIcon, EyeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { CompressLevelPicker, CompressSizeChange } from '@/components/common/image-compress/compress-level-picker'
import { CompressPreviewDialog } from '@/components/common/image-compress/compress-preview-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useClipboardFilePaste } from '@/hooks/use-clipboard-file-paste'
import { useCompressLevel, useCompressPreview } from '@/hooks/use-image-compress'
import { useObjectUrl } from '@/hooks/use-object-url'
import { useErrorMessageT, useOperationT } from '@/hooks/use-translations'
import { mimeCategoryFromFile, mimeTypeIcons } from '@/utils/client/file'
import { isCompressibleImage } from '@/utils/client/image-compress'

const MAX_FILE_NUM_PER_UPLOAD = 20

export function FileUploadDialogWithButton({
  children,
  onFilesUpload,
  limit = MAX_FILE_NUM_PER_UPLOAD,
  className,
}: {
  children?: React.ReactNode
  onFilesUpload: (files?: File[]) => void
  limit?: number
  className?: string
}) {
  const t = useTranslations('Console.files')
  const errorMessageT = useErrorMessageT()
  const operationT = useOperationT()
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  // 记住上次选择的压缩档位；选中的图片在后台预先压缩，用于展示体积与预览，上传时复用结果
  const [compressLevel, setCompressLevel] = useCompressLevel()
  const compressPreview = useCompressPreview(files, compressLevel)
  const compressibleImages = files.filter(isCompressibleImage)

  // 粘贴回调与选择文件共用同一套数量上限校验，需要读到最新的文件列表
  const filesRef = useRef(files)
  filesRef.current = files

  const appendFiles = (incoming: File[]) => {
    if (incoming.length === 0)
      return
    if (filesRef.current.length + incoming.length > limit) {
      toast.error(t('can_only_upload_n_files_at_a_time', { n: limit }))
      return
    }
    setFiles(prev => [...prev, ...incoming])
  }

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (!selectedFiles)
      return
    appendFiles(Array.from(selectedFiles))
    e.target.value = ''
  }

  // 弹窗打开时支持直接粘贴剪贴板中的文件（如截图）
  useClipboardFilePaste({ enabled: open, onFiles: appendFiles })

  const handleSubmit = async () => {
    if (files.length === 0)
      return

    const uploadPromises = files.map(file =>
      uploadFile({ file, compressLevel })
        .then(() => {
          toast.success(t('upload_file_success', { name: file.name }))
          return { success: true, file }
        })
        .catch((err: unknown) => {
          toast.error(
            `${t('upload_file_failed', { name: file.name })}: ${errorMessageT(err)}`,
          )
          return { success: false, file, error: err }
        }),
    )

    // 等待所有上传完成
    const results = await Promise.allSettled(uploadPromises)
    // 统计结果
    const successCount = results.filter(
      result => result.status === 'fulfilled' && result.value.success,
    ).length
    const failedCount = results.length - successCount
    // 显示总体结果
    if (successCount > 0) {
      toast.success(t('upload_n_files_success', { n: successCount }))
    }
    if (failedCount > 0) {
      toast.error(t('upload_n_files_failed', { n: failedCount }))
    }
    setFiles([])
    onFilesUpload()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || <Button size="sm" className={className}>{operationT('upload')}</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload_file')}</DialogTitle>
          <DialogDescription>{t('select_file')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-2">
            <Input multiple id="files" type="file" onChange={handleFilesSelected} />
            <p className="text-xs text-muted-foreground">{t('paste_hint')}</p>
          </div>
          <CompressLevelPicker
            value={compressLevel}
            onValueChange={setCompressLevel}
            sizes={compressPreview.sizesOf(compressibleImages)}
          />
          {files.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {files.map((file, index) => (
                <FileUploadPreviewItem
                  key={index}
                  file={file}
                  compressLevel={compressLevel}
                  onCompressLevelChange={setCompressLevel}
                  compressPreview={compressPreview}
                  onFileCancel={file => setFiles(prev => prev.filter(f => f !== file))}
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter>

          <DialogClose asChild>
            <div className="flex gap-2">
              <Button variant="outline">{operationT('cancel')}</Button>
              <Button disabled={files.length === 0} onClick={handleSubmit}>
                {operationT('upload')}
              </Button>
            </div>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FileUploadPreviewItem({
  file,
  compressLevel,
  onCompressLevelChange,
  compressPreview,
  onFileCancel,
}: {
  file: File
  compressLevel: number
  onCompressLevelChange: (level: number) => void
  compressPreview: CompressPreview
  onFileCancel: (file: File) => void
}) {
  const t = useTranslations('ImageCompress')
  // 压缩结果陆续算好时列表会多次重渲染，预览地址需随文件缓存，不能每次渲染都新建
  const previewUrl = useObjectUrl(file)
  return (
    <div className="flex items-center gap-3 p-2 border border-border rounded w-full overflow-hidden">
      <div className="flex-shrink-0 w-10 h-10 bg-muted rounded overflow-hidden flex items-center justify-center">
        <Avatar className="h-full w-full rounded-sm">
          <AvatarImage
            className="object-contain w-full h-full"
            src={previewUrl ?? undefined}
            alt={file.name}
          />
          <AvatarFallback>
            {(() => {
              const IconComponent = mimeTypeIcons[mimeCategoryFromFile(file)]
              return <IconComponent className="w-8 h-8" />
            })()}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="w-0 flex-1">
        <div className="font-medium leading-none truncate max-w-full">{file.name}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          <CompressSizeChange file={file} level={compressLevel} result={compressPreview.resultOf(file)} />
        </div>
      </div>

      {isCompressibleImage(file) && (
        <CompressPreviewDialog
          file={file}
          level={compressLevel}
          onLevelChange={onCompressLevelChange}
          preview={compressPreview}
        >
          <Button type="button" className="flex-shrink-0" variant="ghost" size="icon" aria-label={t('preview')} title={t('preview')}>
            <EyeIcon className="w-5 h-5" />
          </Button>
        </CompressPreviewDialog>
      )}

      <Button
        className="flex-shrink-0"
        variant="ghost"
        size="icon"
        onClick={() => onFileCancel(file)}
      >
        <CircleXIcon className="w-5 h-5" />
      </Button>
    </div>
  )
}
