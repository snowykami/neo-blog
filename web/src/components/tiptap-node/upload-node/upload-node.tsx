'use client'

import type { NodeViewProps } from '@tiptap/react'
import type { UploadMediaType } from './upload-node-extension'
import type { PickedAsset } from '@/components/common/asset-picker'
import { NodeViewWrapper } from '@tiptap/react'
import { CloudUploadIcon, FolderOpenIcon, ImageUpIcon, VideoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { AssetPicker } from '@/components/common/asset-picker'
import { Button } from '@/components/ui/button'
import { focusNextNode, isValidPosition } from '@/lib/tiptap-utils'
import { markUploadingPlaceholder, takeQueuedUploadFiles, UploadControllers } from './upload-queue'

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

export interface UploadOptions {
  /**
   * Maximum number of files that can be uploaded
   */
  limit: number
  /**
   * 一次选择的文件超过 limit 时调用（由节点视图负责本地化提示）
   */
  onTooMany: (limit: number) => void
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
  // 进行中的上传：节点视图销毁（占位块被删除、撤销、离开编辑页）时全部取消，避免留下无人引用的文件
  const controllersRef = React.useRef<UploadControllers | null>(null)
  controllersRef.current ??= new UploadControllers()
  React.useEffect(() => {
    const controllers = controllersRef.current
    return () => controllers?.abortAll()
  }, [])

  // 大小不在这里校验：图片要按压缩后的大小判断，由 options.upload（编辑页的 uploadMedia）统一校验并提示，返回空地址
  const uploadFile = async (file: File): Promise<string | null> => {
    const controllers = controllersRef.current ?? new UploadControllers()
    const abortController = controllers.start()
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
    finally {
      controllers.finish(abortController)
    }
  }

  const uploadFiles = async (files: File[]): Promise<(string | null)[]> => {
    if (!files || files.length === 0)
      return []

    if (options.limit && files.length > options.limit) {
      options.onTooMany(options.limit)
      return []
    }

    // 并发上传：结果与 files 一一对应，失败的为 null
    return Promise.all(files.map(file => uploadFile(file)))
  }

  const removeFileItem = (fileId: string) => {
    setFileItems((prev) => {
      const fileToRemove = prev.find(item => item.id === fileId)
      fileToRemove?.abortController?.abort()
      return prev.filter(item => item.id !== fileId)
    })
  }

  const clearAllFiles = () => {
    fileItems.forEach((item) => {
      item.abortController?.abort()
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

interface UploadDragAreaProps {
  onFile: (files: File[]) => void
  children?: React.ReactNode
}

const UploadDragArea: React.FC<UploadDragAreaProps> = ({ onFile, children }) => {
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

interface UploadPreviewProps {
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
const UploadPreview: React.FC<UploadPreviewProps> = ({ fileItem, onRemove }) => {
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

const DropZoneContent: React.FC<{ mediaType: UploadMediaType, maxSize: number, limit: number }> = ({ mediaType, maxSize, limit }) => {
  const t = useTranslations('Console.editor')
  const video = mediaType === 'video'
  const Icon = video ? VideoIcon : ImageUpIcon
  return (
    <>
      <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="text-sm text-foreground/85">{t(video ? 'upload_dropzone_video' : 'upload_dropzone')}</span>
      <span className="text-xs text-muted-foreground">{t(video ? 'upload_limit_video' : 'upload_limit', { count: limit, size: maxSize / 1024 / 1024 })}</span>
    </>
  )
}

export const UploadNode: React.FC<NodeViewProps> = (props) => {
  const { accept, limit, maxSize } = props.node.attrs
  const t = useTranslations('AssetPicker')
  const editorT = useTranslations('Console.editor')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const extension = props.extension
  const mediaType: UploadMediaType = extension.options.mediaType ?? 'image'
  const video = mediaType === 'video'

  const uploadOptions: UploadOptions = {
    limit,
    onTooMany: count => toast.error(editorT(video ? 'upload_too_many_video' : 'upload_too_many', { count })),
    accept,
    upload: extension.options.upload,
    onSuccess: extension.options.onSuccess,
    onError: extension.options.onError,
  }

  const { fileItems, uploadFiles, removeFileItem, clearAllFiles } = useFileUpload(uploadOptions)

  // 上传进行中的占位块：保存草稿时剔除（见 upload-queue.ts），上传结束后取消标记
  const uploading = fileItems.some(item => item.status === 'uploading')
  React.useEffect(() => {
    markUploadingPlaceholder(props.node, uploading)
  }, [props.node, uploading])

  const insertMedia = (media: Array<{ url: string, name?: string }>) => {
    if (media.length === 0) {
      return
    }
    const pos = props.getPos()
    // 上传期间占位块可能已被删除（撤销、手动删除），位置失效时会误删其他内容
    if (!isValidPosition(pos) || props.editor.state.doc.nodeAt(pos)?.type.name !== props.node.type.name)
      return

    const nodes = media.map((item) => {
      // 图片沿用文件名作为 alt / title，视频节点只有地址
      const filename = item.name?.replace(/\.[^/.]+$/, '') || 'unknown'
      return {
        type: extension.options.type,
        attrs: video ? { src: item.url } : { src: item.url, alt: filename, title: filename },
      }
    })

    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + props.node.nodeSize })
      .insertContentAt(pos, nodes)
      .run()

    focusNextNode(props.editor)
  }

  const handleUpload = async (files: File[]) => {
    // 结果与 files 一一对应（失败为 null），避免按索引取文件名时错位
    const urls = await uploadFiles(files)
    const media = urls.flatMap((url, index) => (url ? [{ url, name: files[index]?.name }] : []))
    insertMedia(media)
  }

  // 拖入的文件（见 upload-queue.ts）：挂载后自动开始上传；延后一拍，StrictMode 的挂载—卸载—挂载不会取走文件后又被取消
  const uploadId = props.node.attrs.uploadId as string | null
  const handleUploadRef = React.useRef(handleUpload)
  handleUploadRef.current = handleUpload
  React.useEffect(() => {
    if (!uploadId)
      return
    const timer = window.setTimeout(() => {
      const files = takeQueuedUploadFiles(uploadId)
      if (files?.length)
        void handleUploadRef.current(files)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [uploadId])

  const handleAssetSelect = (assets: PickedAsset[]) => {
    insertMedia(assets.map(asset => ({ url: asset.url, name: asset.name })))
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0)
      return
    handleUpload(Array.from(files))
  }

  const handleClick = () => {
    // 上传中的文件不重复打开选择框；失败项保留在列表里，可以点占位区域重新选择
    if (inputRef.current && !fileItems.some(item => item.status === 'uploading')) {
      inputRef.current.value = ''
      inputRef.current.click()
    }
  }

  const hasFiles = fileItems.length > 0

  return (
    <NodeViewWrapper
      className="tiptap-upload my-6"
      tabIndex={0}
      // 里面还有「从资源库选择」按钮，不能整体作为 button，用带名称的 group，并支持 Enter / 空格打开文件选择
      role="group"
      aria-label={editorT(video ? 'upload_dropzone_video' : 'upload_dropzone')}
      onClick={handleClick}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' '))
          return
        e.preventDefault()
        handleClick()
      }}
    >
      {!hasFiles && (
        <UploadDragArea onFile={handleUpload}>
          <DropZoneContent mediaType={mediaType} maxSize={maxSize} limit={limit} />
          {/* 弹层内的点击会沿 React 树冒泡到节点，阻止其触发本地文件选择 */}
          <div className="mt-1" onClick={e => e.stopPropagation()}>
            <AssetPicker accept={accept} multiple={limit > 1} max={limit} maxSize={maxSize} onSelect={handleAssetSelect}>
              <Button type="button" variant="outline" size="sm">
                <FolderOpenIcon />
                {t('choose_from_library')}
              </Button>
            </AssetPicker>
          </div>
        </UploadDragArea>
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
            <UploadPreview
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
