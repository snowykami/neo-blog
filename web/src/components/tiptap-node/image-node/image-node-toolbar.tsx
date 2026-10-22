'use client'

import type { Editor } from '@tiptap/react'
import type { UploadFunction } from '@/components/tiptap-node/image-upload-node/image-upload-node-extension'
import { DownloadIcon, ReplaceIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { EditorToolbarButton, EditorToolbarSeparator } from '@/components/tiptap-editor/editor-toolbar-button'
import { downloadSelectedImage } from '@/components/tiptap-ui/image-download-button/use-image-download'
import { IMAGE_TOOLBAR_ATTR } from './image-node-constants'

export type ImageAlign = 'left' | 'center' | 'right'

const ALIGNS: { id: ImageAlign, icon: typeof TextAlignStartIcon }[] = [
  { id: 'left', icon: TextAlignStartIcon },
  { id: 'center', icon: TextAlignCenterIcon },
  { id: 'right', icon: TextAlignEndIcon },
]

export interface ImageNodeToolbarProps {
  editor: Editor
  align: ImageAlign
  onAlignChange: (align: ImageAlign) => void
  onReplace: (src: string, name: string) => void
  onDelete: () => void
  onUploadingChange: (uploading: boolean) => void
}

/**
 * 图片浮动工具栏：附着在选中的图片上（对齐 / 替换 / 下载 / 删除），不占用主工具栏
 */
export function ImageNodeToolbar({ editor, align, onAlignChange, onReplace, onDelete, onUploadingChange }: ImageNodeToolbarProps) {
  const t = useTranslations('Console.editor')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 替换图片沿用图片上传块的上传函数
  const upload = editor.extensionManager.extensions.find(ext => ext.name === 'imageUpload')?.options.upload as UploadFunction | undefined

  const handleFile = async (file: File | undefined) => {
    if (!file || !upload)
      return
    onUploadingChange(true)
    try {
      const url = await upload(file)
      if (url)
        onReplace(url, file.name.replace(/\.[^/.]+$/, ''))
    }
    finally {
      onUploadingChange(false)
    }
  }

  return (
    <div
      {...{ [IMAGE_TOOLBAR_ATTR]: '' }}
      role="toolbar"
      aria-label={t('image_toolbar')}
      contentEditable={false}
      className="absolute top-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-popover p-1 whitespace-nowrap text-popover-foreground shadow-lg"
    >
      {ALIGNS.map(({ id, icon: Icon }) => (
        <EditorToolbarButton
          key={id}
          label={t(`image_align_${id}`)}
          active={align === id}
          className="h-[30px] min-w-[30px]"
          onClick={() => onAlignChange(id)}
        >
          <Icon className="size-[17px]" />
        </EditorToolbarButton>
      ))}
      <EditorToolbarSeparator className="mx-1" />
      <EditorToolbarButton label={t('image_replace')} className="h-[30px] min-w-[30px]" disabled={!upload} onClick={() => inputRef.current?.click()}>
        <ReplaceIcon className="size-[17px]" />
      </EditorToolbarButton>
      <EditorToolbarButton label={t('image_download')} shortcut="mod+shift+d" className="h-[30px] min-w-[30px]" onClick={() => void downloadSelectedImage(editor)}>
        <DownloadIcon className="size-[17px]" />
      </EditorToolbarButton>
      <EditorToolbarButton
        label={t('image_delete')}
        shortcut="backspace"
        className="h-[30px] min-w-[30px] text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2Icon className="size-[17px]" />
      </EditorToolbarButton>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void handleFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
