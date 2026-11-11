'use client'

import type { PickedAsset } from '@/components/common/asset-picker'
import type { CommentAttachment } from '@/models/comment'
import { Loader2, Paperclip, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { AssetPicker } from '@/components/common/asset-picker'
import { SafeImage } from '@/components/common/safe-image'
import { endIslandUpload, reportIslandUpload } from '@/components/layout/topbar-island/upload-island'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useCompressLevel } from '@/hooks/use-image-compress'
import { useObjectUrl } from '@/hooks/use-object-url'
import { useErrorMessageT } from '@/hooks/use-translations'
import { getFileUri, mimeTypeIcons } from '@/utils/client/file'
import { compressImage } from '@/utils/client/image-compress'
import { formatDataSize } from '@/utils/common/datasize'
import { isEditor } from '@/utils/common/permission'
import { attachmentKind, attachmentName, MAX_COMMENT_ATTACHMENTS } from './comment-attachments'

/** 普通用户只能上传图片（不含 SVG），单个不超过 10 MiB，与后端上传限制一致；编辑和管理员不受限 */
const USER_UPLOAD_MAX_SIZE = 10 * 1024 * 1024
const USER_UPLOAD_ACCEPT = 'image/*'

interface AttachmentItem {
  key: string
  attachment?: CommentAttachment // 上传完成或从资产库选择后才有
  file?: File // 本地粘贴 / 拖入的文件，用于上传中的预览
  controller?: AbortController
}

/**
 * 评论框的附件：粘贴、拖入的文件立即上传，也可以从资产库选择；最多 9 个，超出的部分提示后丢弃
 */
export function useCommentAttachments(initial: CommentAttachment[] = []) {
  const t = useTranslations('Comment')
  const errorMessageT = useErrorMessageT()
  const { user } = useAuth()
  const [compressLevel] = useCompressLevel()
  const [items, setItems] = useState<AttachmentItem[]>(() => initial.map(attachment => ({ key: `file-${attachment.id}`, attachment })))
  // 资产库弹窗打开期间焦点在弹窗里，评论框据此保持展开，避免收起时把弹窗一起卸载
  const [pickerOpen, setPickerOpen] = useState(false)
  const itemsRef = useRef(items)
  itemsRef.current = items
  // 评论框关闭（组件卸载）时中止仍在进行的上传
  useEffect(() => () => itemsRef.current.forEach(item => item.controller?.abort()), [])

  const unrestricted = !!user && isEditor({ user })
  const accept = unrestricted ? undefined : USER_UPLOAD_ACCEPT
  const maxSize = unrestricted ? undefined : USER_UPLOAD_MAX_SIZE

  // 只保留剩余名额内的部分，超出时提示
  const takeSlots = <T,>(list: T[]) => {
    const free = MAX_COMMENT_ATTACHMENTS - itemsRef.current.length
    if (list.length > free)
      toast.warning(t('attachments_max', { count: MAX_COMMENT_ATTACHMENTS }))
    return list.slice(0, Math.max(0, free))
  }

  const upload = async (item: AttachmentItem & { file: File, controller: AbortController }) => {
    try {
      // 先压缩以取得实际上传文件的名字与类型（PNG 可能转为 WebP），uploadFile 会复用同一结果
      const prepared = await compressImage(item.file, compressLevel)
      // 顶栏灵动岛同步显示上传进度（后台关闭时不显示）
      reportIslandUpload(item.key, 0, t('attachment_uploading'))
      const res = await uploadFile({ file: item.file, compressLevel, signal: item.controller.signal, onProgress: percent => reportIslandUpload(item.key, percent, t('attachment_uploading')) })
      const attachment: CommentAttachment = { id: res.data.id, url: getFileUri(res.data.id), name: prepared.name, mimeType: prepared.type, size: prepared.size }
      setItems(prev => prev.map(other => (other.key === item.key ? { ...other, attachment, controller: undefined } : other)))
    }
    catch (error) {
      if (item.controller.signal.aborted)
        return
      toast.error(`${t('attachment_upload_failed', { name: item.file.name })}: ${errorMessageT(error)}`)
      setItems(prev => prev.filter(other => other.key !== item.key))
    }
    finally {
      endIslandUpload(item.key)
    }
  }

  const addFiles = (files: File[]) => {
    const accepted = files.filter((file) => {
      if (!unrestricted && !(file.type.startsWith('image/') && file.type !== 'image/svg+xml')) {
        toast.error(t('attachment_image_only', { name: file.name }))
        return false
      }
      if (maxSize && file.size > maxSize) {
        toast.error(t('attachment_too_large', { name: file.name, size: formatDataSize({ size: maxSize }) }))
        return false
      }
      return true
    })
    const added = takeSlots(accepted).map(file => ({ key: crypto.randomUUID(), file, controller: new AbortController() }))
    if (added.length === 0)
      return
    setItems(prev => [...prev, ...added])
    added.forEach(item => void upload(item))
  }

  const addAssets = (assets: PickedAsset[]) => {
    const fresh = assets.filter(asset => !itemsRef.current.some(item => item.attachment?.id === asset.id))
    const added = takeSlots(fresh).map(({ id, url, name, mimeType, size }) => ({ key: `file-${id}`, attachment: { id, url, name, mimeType, size } }))
    setItems(prev => [...prev, ...added])
  }

  const remove = (key: string) => {
    itemsRef.current.find(item => item.key === key)?.controller?.abort()
    setItems(prev => prev.filter(item => item.key !== key))
  }

  return {
    items,
    attachments: items.flatMap(item => (item.attachment ? [item.attachment] : [])),
    uploading: items.some(item => !item.attachment),
    accept,
    maxSize,
    addFiles,
    addAssets,
    remove,
    clear: () => setItems([]),
    pickerOpen,
    setPickerOpen,
  }
}

export type CommentAttachmentsState = ReturnType<typeof useCommentAttachments>

/** 工具栏上的「添加附件」：从资产库选择或在弹窗内上传，剩余名额为 0 时禁用 */
export function CommentAttachmentButton({ state }: { state: CommentAttachmentsState }) {
  const t = useTranslations('Comment')
  const remaining = MAX_COMMENT_ATTACHMENTS - state.items.length
  return (
    <AssetPicker
      open={state.pickerOpen}
      onOpenChange={state.setPickerOpen}
      title={t('add_attachment')}
      accept={state.accept}
      maxSize={state.maxSize}
      multiple
      // 名额用完时按钮禁用；max 为 0 表示不限，因此至少传 1
      max={Math.max(1, remaining)}
      onSelect={state.addAssets}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={remaining <= 0}
        title={remaining <= 0 ? t('attachments_max', { count: MAX_COMMENT_ATTACHMENTS }) : t('add_attachment_hint')}
        aria-label={t('add_attachment')}
        className="h-7 rounded-full px-2.5 text-xs font-normal text-muted-foreground max-sm:h-9 max-sm:px-3"
      >
        <Paperclip className="size-3.5" />
        {state.items.length > 0 && <span className="tabular-nums">{`${state.items.length}/${MAX_COMMENT_ATTACHMENTS}`}</span>}
      </Button>
    </AssetPicker>
  )
}

/** 评论框内的附件缩略图：上传中显示进度圈，可逐个移除 */
export function CommentAttachmentList({ state }: { state: CommentAttachmentsState }) {
  if (state.items.length === 0)
    return null
  return (
    <ul className="flex flex-wrap gap-2 px-3 pb-2">
      {state.items.map(item => <AttachmentThumb key={item.key} item={item} onRemove={() => state.remove(item.key)} />)}
    </ul>
  )
}

function AttachmentThumb({ item, onRemove }: { item: AttachmentItem, onRemove: () => void }) {
  const t = useTranslations('Comment')
  const kind = item.attachment ? attachmentKind(item.attachment.mimeType) : attachmentKind(item.file?.type ?? '')
  const name = item.attachment ? attachmentName(item.attachment) : item.file?.name ?? ''
  // 本地文件直接预览，不必等上传完成再从服务器加载
  const localUrl = useObjectUrl(kind === 'image' ? item.file : null)
  const src = localUrl ?? (kind === 'image' ? item.attachment?.url : undefined)
  const Icon = mimeTypeIcons[kind]

  return (
    <li title={name} className="relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
      {src
        ? <SafeImage src={src} alt={name} fill sizes="64px" className="object-cover" />
        : (
            <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
              <Icon aria-hidden className="size-5" />
              <span className="w-full truncate text-center text-[10px]">{name}</span>
            </div>
          )}
      {!item.attachment && (
        <div role="status" aria-label={t('attachment_uploading')} className="absolute inset-0 grid place-items-center bg-background/60">
          <Loader2 className="size-4 animate-spin text-foreground/70" />
        </div>
      )}
      {/* 圆点保持 20px，按下区域用伪元素扩到 32px（向缩略图内部延伸，不被 overflow-hidden 裁掉） */}
      <button
        type="button"
        aria-label={t('remove_attachment', { name })}
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white transition-colors after:absolute after:-right-0.5 after:-top-0.5 after:size-8 after:content-[''] hover:bg-black/80 max-sm:size-6"
      >
        <X className="size-3" />
      </button>
    </li>
  )
}
