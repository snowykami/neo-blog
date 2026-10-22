'use client'

import type { PickedAsset } from './utils'
import { CheckCircle2Icon, CircleAlertIcon, CloudUploadIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useErrorMessageT } from '@/hooks/use-translations'
import { formatDataSize } from '@/utils/common/datasize'
import { matchAccept, toPickedAsset } from './utils'

interface UploadItem {
  key: string
  file: File
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
  controller: AbortController
}

const COMPRESS_LEVELS = Array.from({ length: 11 }, (_, i) => i)

/**
 * 本地上传：拖拽或点击选择文件，逐个上传并显示进度；每个文件上传成功后回调 onUploaded，
 * 一批全部结束后回调 onBatchDone（至少成功一个时）
 */
export function AssetUploader({
  accept,
  multiple,
  maxSize,
  defaultCompressLevel,
  onUploaded,
  onBatchDone,
}: {
  accept?: string
  multiple: boolean
  maxSize?: number
  defaultCompressLevel: number
  onUploaded: (asset: PickedAsset) => void
  onBatchDone: () => void
}) {
  const t = useTranslations('AssetPicker')
  const errorMessageT = useErrorMessageT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [items, setItems] = React.useState<UploadItem[]>([])
  const [dragOver, setDragOver] = React.useState(false)
  const [compressLevel, setCompressLevel] = React.useState(defaultCompressLevel)

  // 关闭弹窗（组件卸载）时中止仍在进行的上传
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  React.useEffect(() => () => itemsRef.current.forEach(item => item.status === 'uploading' && item.controller.abort()), [])

  const updateItem = (key: string, patch: Partial<UploadItem>) =>
    setItems(prev => prev.map(item => (item.key === key ? { ...item, ...patch } : item)))

  const uploadOne = async (item: UploadItem) => {
    try {
      const res = await uploadFile({
        file: item.file,
        compressLevel,
        signal: item.controller.signal,
        onProgress: progress => updateItem(item.key, { progress }),
      })
      updateItem(item.key, { status: 'success', progress: 100 })
      onUploaded(toPickedAsset({ id: res.data.id, name: item.file.name, mimeType: item.file.type, size: item.file.size }))
      return true
    }
    catch (error: unknown) {
      if (!item.controller.signal.aborted)
        updateItem(item.key, { status: 'error', error: errorMessageT(error, t('upload_failed')) })
      return false
    }
  }

  const handleFiles = async (list: FileList | File[] | null) => {
    let files = Array.from(list ?? [])
    if (files.length === 0)
      return
    if (!multiple)
      files = files.slice(0, 1)
    const accepted = files.filter((file) => {
      if (!matchAccept({ name: file.name, mimeType: file.type }, accept)) {
        toast.error(t('unsupported_type', { name: file.name }))
        return false
      }
      if (maxSize && file.size > maxSize) {
        toast.error(t('file_too_large', { name: file.name, size: formatDataSize({ size: maxSize }) }))
        return false
      }
      return true
    })
    if (accepted.length === 0)
      return
    const newItems: UploadItem[] = accepted.map(file => ({
      key: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'uploading',
      controller: new AbortController(),
    }))
    setItems(prev => [...newItems, ...prev])
    const results = await Promise.all(newItems.map(uploadOne))
    if (results.some(Boolean))
      onBatchDone()
  }

  const removeItem = (item: UploadItem) => {
    item.controller.abort()
    setItems(prev => prev.filter(other => other.key !== item.key))
  }

  return (
    <div className="grid gap-3">
      <div
        role="button"
        tabIndex={0}
        data-drag-over={dragOver}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-muted/40 px-6 py-10 text-center outline-none transition-colors hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[drag-over=true]:border-primary data-[drag-over=true]:bg-primary/5"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <CloudUploadIcon className="size-5" />
        </span>
        <span className="text-sm text-foreground/85">{t('dropzone')}</span>
        <span className="text-xs text-muted-foreground">
          {[accept && accept !== '*' ? t('accept_hint', { accept }) : null, maxSize ? t('size_hint', { size: formatDataSize({ size: maxSize }) }) : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="flex items-center gap-3">
        <Label htmlFor="asset-compress-level" className="text-xs font-normal text-muted-foreground">{t('compress_level')}</Label>
        <Select value={String(compressLevel)} onValueChange={value => setCompressLevel(Number(value))}>
          <SelectTrigger id="asset-compress-level" size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPRESS_LEVELS.map(level => (
              <SelectItem key={level} value={String(level)}>{level === 0 ? t('compress_none') : level}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{t('compress_hint')}</span>
      </div>

      {items.length > 0 && (
        <ul className="grid max-h-56 gap-2 overflow-y-auto">
          {items.map(item => (
            <li key={item.key} className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-center gap-3">
                {item.status === 'success'
                  ? <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
                  : item.status === 'error'
                    ? <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
                    : <CloudUploadIcon className="size-4 shrink-0 text-muted-foreground" />}
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm">{item.file.name}</span>
                  <span className={item.status === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                    {item.status === 'error' ? item.error : item.status === 'success' ? t('upload_done') : formatDataSize({ size: item.file.size })}
                  </span>
                </div>
                {item.status === 'uploading' && <span className="text-xs tabular-nums text-primary">{`${item.progress}%`}</span>}
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('remove')} onClick={() => removeItem(item)}>
                  <XIcon />
                </Button>
              </div>
              {item.status === 'uploading' && <Progress value={item.progress} className="h-1" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
