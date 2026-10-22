'use client'

import type { NodeViewProps } from '@tiptap/react'
import type { PickedAsset } from '@/components/common/asset-picker'
import { NodeViewWrapper } from '@tiptap/react'
import { CloudUploadIcon, FolderOpenIcon, ImageUpIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { AssetPicker } from '@/components/common/asset-picker'
import { Button } from '@/components/ui/button'
import { focusNextNode, isValidPosition } from '@/lib/tiptap-utils'

export interface FileItem {
  /**
   * Unique identifier for the file item
   */
  id: string
  /**
   * The actual File object being uploaded
   */
  file: File
  /**
   * Current upload progress as a percentage (0-100)
   */
  progress: number
  /**
   * Current status of the file upload process
   * @default "uploading"
   */
  status: 'uploading' | 'success' | 'error'

  /**
   * URL to the uploaded file, available after successful upload
   * @optional
   */
  url?: string
  /**
   * Controller that can be used to abort the upload process
   * @optional
   */
  abortController?: AbortController
}

const DEFAULT_IMAGE_NAME = 'unknown'

export interface UploadOptions {
  /**
   * Maximum allowed file size in bytes
   */
  maxSize: number
  /**
   * Maximum number of files that can be uploaded
   */
  limit: number
  /**
   * String specifying acceptable file types (MIME types or extensions)
   * @example ".jpg,.png,image/jpeg" or "image/*"
   */
  accept: string
  /**
   * Function that handles the actual file upload process
   * @param {File} file - The file to be uploaded
   * @param {Function} onProgress - Callback function to report upload progress
   * @param {AbortSignal} signal - Signal that can be used to abort the upload
   * @returns {Promise<string>} Promise resolving to the URL of the uploaded file
   */
  upload: (
    file: File,
    onProgress: (event: { progress: number }) => void,
    signal: AbortSignal,
  ) => Promise<string>
  /**
   * Callback triggered when a file is uploaded successfully
   * @param {string} url - URL of the successfully uploaded file
   * @optional
   */
  onSuccess?: (url: string) => void
  /**
   * Callback triggered when an error occurs during upload
   * @param {Error} error - The error that occurred
   * @optional
   */
  onError?: (error: Error) => void
}

/**
 * Custom hook for managing multiple file uploads with progress tracking and cancellation
 */
function useFileUpload(options: UploadOptions) {
  const [fileItems, setFileItems] = React.useState<FileItem[]>([])

  const uploadFile = async (file: File): Promise<string | null> => {
    if (file.size > options.maxSize) {
      const error = new Error(
        `File size exceeds maximum allowed (${options.maxSize / 1024 / 1024}MB)`,
      )
      options.onError?.(error)
      return null
    }

    const abortController = new AbortController()
    const fileId = crypto.randomUUID()

    const newFileItem: FileItem = {
      id: fileId,
      file,
      progress: 0,
      status: 'uploading',
      abortController,
    }

    setFileItems(prev => [...prev, newFileItem])

    try {
      if (!options.upload) {
        throw new Error('Upload function is not defined')
      }

      const url = await options.upload(
        file,
        (event: { progress: number }) => {
          setFileItems(prev =>
            prev.map(item => (item.id === fileId ? { ...item, progress: event.progress } : item)),
          )
        },
        abortController.signal,
      )

      if (!url)
        throw new Error('Upload failed: No URL returned')

      if (!abortController.signal.aborted) {
        setFileItems(prev =>
          prev.map(item =>
            item.id === fileId ? { ...item, status: 'success', url, progress: 100 } : item,
          ),
        )
        options.onSuccess?.(url)
        return url
      }

      return null
    }
    catch (error) {
      if (!abortController.signal.aborted) {
        setFileItems(prev =>
          prev.map(item =>
            item.id === fileId ? { ...item, status: 'error', progress: 0 } : item,
          ),
        )
        options.onError?.(error instanceof Error ? error : new Error('Upload failed'))
      }
      return null
    }
  }

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!files || files.length === 0) {
      options.onError?.(new Error('No files to upload'))
      return []
    }

    if (options.limit && files.length > options.limit) {
      options.onError?.(
        new Error(`Maximum ${options.limit} file${options.limit === 1 ? '' : 's'} allowed`),
      )
      return []
    }

    // Upload all files concurrently
    const uploadPromises = files.map(file => uploadFile(file))
    const results = await Promise.all(uploadPromises)

    // Filter out null results (failed uploads)
    return results.filter((url): url is string => url !== null)
  }

  const removeFileItem = (fileId: string) => {
    setFileItems((prev) => {
      const fileToRemove = prev.find(item => item.id === fileId)
      if (fileToRemove?.abortController) {
        fileToRemove.abortController.abort()
      }
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url)
      }
      return prev.filter(item => item.id !== fileId)
    })
  }

  const clearAllFiles = () => {
    fileItems.forEach((item) => {
      if (item.abortController) {
        item.abortController.abort()
      }
      if (item.url) {
        URL.revokeObjectURL(item.url)
      }
    })
    setFileItems([])
  }

  return {
    fileItems,
    uploadFiles,
    removeFileItem,
    clearAllFiles,
  }
}

interface ImageUploadDragAreaProps {
  onFile: (files: File[]) => void
  children?: React.ReactNode
}

const ImageUploadDragArea: React.FC<ImageUploadDragAreaProps> = ({ onFile, children }) => {
  const [isDragOver, setIsDragOver] = React.useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node))
      setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0)
      onFile(files)
  }

  return (
    <div
      data-drag-over={isDragOver}
      className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-muted/40 px-6 py-8 text-center transition-colors hover:border-foreground/25 data-[drag-over=true]:border-primary data-[drag-over=true]:bg-primary/5"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  )
}

interface ImageUploadPreviewProps {
  fileItem: FileItem
  onRemove: () => void
}

function formatFileSize(bytes: number) {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/** 上传中的文件：文件名、大小与进度条 */
const ImageUploadPreview: React.FC<ImageUploadPreviewProps> = ({ fileItem, onRemove }) => {
  const t = useTranslations('Console.editor')
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card">
      {fileItem.status === 'uploading' && (
        <div className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-300" style={{ width: `${fileItem.progress}%` }} />
      )}
      <div className="relative flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <CloudUploadIcon className="size-4" />
          </span>
          <div className="grid min-w-0">
            <span className="truncate text-sm text-foreground/90">{fileItem.file.name}</span>
            <span className="text-xs text-muted-foreground">
              {fileItem.status === 'error' ? t('upload_failed_item') : formatFileSize(fileItem.file.size)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fileItem.status === 'uploading' && <span className="text-xs text-primary tabular-nums">{`${fileItem.progress}%`}</span>}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('upload_remove')}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <XIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

const DropZoneContent: React.FC<{ maxSize: number, limit: number }> = ({ maxSize, limit }) => {
  const t = useTranslations('Console.editor')
  return (
    <>
      <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <ImageUpIcon className="size-5" />
      </span>
      <span className="text-sm text-foreground/85">{t('upload_dropzone')}</span>
      <span className="text-xs text-muted-foreground">{t('upload_limit', { count: limit, size: maxSize / 1024 / 1024 })}</span>
    </>
  )
}

export const ImageUploadNode: React.FC<NodeViewProps> = (props) => {
  const { accept, limit, maxSize } = props.node.attrs
  const t = useTranslations('AssetPicker')
  const editorT = useTranslations('Console.editor')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const extension = props.extension

  const uploadOptions: UploadOptions = {
    maxSize,
    limit,
    accept,
    upload: extension.options.upload,
    onSuccess: extension.options.onSuccess,
    onError: extension.options.onError,
  }

  const { fileItems, uploadFiles, removeFileItem, clearAllFiles } = useFileUpload(uploadOptions)

  const insertImages = (images: Array<{ url: string, name?: string }>) => {
    if (images.length === 0) {
      return
    }
    const pos = props.getPos()

    if (isValidPosition(pos)) {
      const imageNodes = images.map((image) => {
        const filename = image.name?.replace(/\.[^/.]+$/, '') || DEFAULT_IMAGE_NAME
        return {
          type: extension.options.type,
          attrs: {
            ...extension.options,
            src: image.url,
            alt: filename,
            title: filename,
          },
        }
      })

      props.editor
        .chain()
        .focus()
        .deleteRange({ from: pos, to: pos + props.node.nodeSize })
        .insertContentAt(pos, imageNodes)
        .run()

      focusNextNode(props.editor)
    }
  }

  const handleUpload = async (files: File[]) => {
    const urls = await uploadFiles(files)

    if (urls.length > 0) {
      insertImages(urls.map((url, index) => ({ url, name: files[index]?.name })))
    }
  }

  const handleAssetSelect = (assets: PickedAsset[]) => {
    insertImages(assets.map(asset => ({ url: asset.url, name: asset.name })))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) {
      extension.options.onError?.(new Error('No file selected'))
      return
    }
    handleUpload(Array.from(files))
  }

  const handleClick = () => {
    if (inputRef.current && fileItems.length === 0) {
      inputRef.current.value = ''
      inputRef.current.click()
    }
  }

  const hasFiles = fileItems.length > 0

  return (
    <NodeViewWrapper className="tiptap-image-upload my-6" tabIndex={0} onClick={handleClick}>
      {!hasFiles && (
        <ImageUploadDragArea onFile={handleUpload}>
          <DropZoneContent maxSize={maxSize} limit={limit} />
          {/* 弹层内的点击会沿 React 树冒泡到节点，阻止其触发本地文件选择 */}
          <div className="mt-1" onClick={e => e.stopPropagation()}>
            <AssetPicker accept={accept} multiple={limit > 1} max={limit} maxSize={maxSize} onSelect={handleAssetSelect}>
              <Button type="button" variant="outline" size="sm">
                <FolderOpenIcon />
                {t('choose_from_library')}
              </Button>
            </AssetPicker>
          </div>
        </ImageUploadDragArea>
      )}

      {hasFiles && (
        <div className="grid gap-2">
          {fileItems.length > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{editorT('upload_uploading_count', { count: fileItems.length })}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  clearAllFiles()
                }}
              >
                {editorT('upload_clear_all')}
              </Button>
            </div>
          )}
          {fileItems.map(fileItem => (
            <ImageUploadPreview
              key={fileItem.id}
              fileItem={fileItem}
              onRemove={() => removeFileItem(fileItem.id)}
            />
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        name="file"
        accept={accept}
        type="file"
        hidden
        multiple={limit > 1}
        onChange={handleChange}
        onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
      />
    </NodeViewWrapper>
  )
}
