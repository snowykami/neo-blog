'use client'

import type { ChangeEvent } from 'react'
import type { BaseResponseError } from '../../../models/resp'
import { CircleXIcon, FileIcon } from 'lucide-react'
import mime from 'mime-types'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
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
import { useOperationT } from '@/hooks/translations'
import { formatDataSize } from '@/utils/common/datasize'
import { mimeTypeIcons } from '@/utils/common/mimetype'

const MAX_FILE_NUM_PER_UPLOAD = 20

export function FileUploadDialogWithButton({ onFilesUpload }: { onFilesUpload: () => void }) {
  const t = useTranslations('Console.files')
  const operationT = useOperationT()
  const [files, setFiles] = useState<File[]>([])

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (!selectedFiles)
      return
    if (selectedFiles.length + files.length > MAX_FILE_NUM_PER_UPLOAD) {
      toast.error(t('can_only_upload_n_files_at_a_time', { n: MAX_FILE_NUM_PER_UPLOAD }))
      return
    }
    setFiles([...files, ...Array.from(selectedFiles)])
    e.target.value = ''
  }

  const handleSubmit = async () => {
    if (files.length === 0)
      return

    const uploadPromises = files.map(file =>
      uploadFile({ file })
        .then(() => {
          toast.success(t('upload_file_success', { name: file.name }))
          return { success: true, file }
        })
        .catch((err: BaseResponseError) => {
          toast.error(
            `${t('upload_file_failed', { name: file.name })}: ${err?.response?.data?.message || err.message}`,
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
      toast.success(`成功上传 ${successCount} 个文件`)
    }
    if (failedCount > 0) {
      toast.error(`${failedCount} 个文件上传失败`)
    }
    setFiles([])
    onFilesUpload()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">{operationT('upload')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('upload_file')}</DialogTitle>
          <DialogDescription>{t('select_file')}</DialogDescription>
        </DialogHeader>
        <div>
          <Input multiple id="files" type="file" onChange={handleFilesSelected} />
          <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
            {files.map((file, index) => (
              <FileUploadPreviewItem
                key={index}
                file={file}
                onFileCancel={file => setFiles(prev => prev.filter(f => f !== file))}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <DialogClose>
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
  onFileCancel,
}: {
  file: File
  onFileCancel: (file: File) => void
}) {
  return (
    <div className="flex items-center gap-3 p-2 border border-border rounded w-full overflow-hidden">
      <div className="flex-shrink-0 w-10 h-10 bg-muted rounded overflow-hidden flex items-center justify-center">
        <Avatar className="h-full w-full rounded-sm">
          <AvatarImage
            className="object-contain w-full h-full"
            src={URL.createObjectURL(file)}
            alt={file.name}
          />
          <AvatarFallback>
            {(() => {
              const mimeType = file.type.split('/')[0] || mime.lookup(file.name) || ''
              const IconComponent = mimeTypeIcons?.[mimeType as keyof typeof mimeTypeIcons]
              return IconComponent
                ? (
                    <IconComponent className="w-8 h-8" />
                  )
                : (
                    <FileIcon className="w-8 h-8" />
                  )
            })()}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="w-0 flex-1">
        <div className="font-medium leading-none truncate max-w-full">{file.name}</div>
        <div className="text-xs text-muted-foreground">{formatDataSize({ size: file.size })}</div>
      </div>

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
