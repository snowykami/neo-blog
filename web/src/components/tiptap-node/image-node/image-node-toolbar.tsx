'use client'

import type { Editor } from '@tiptap/react'
import { DownloadIcon, ReplaceIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AssetPicker } from '@/components/common/asset-picker'
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
}

/**
 * 图片浮动工具栏：附着在选中的图片上（对齐 / 替换 / 下载 / 删除），不占用主工具栏
 */
export function ImageNodeToolbar({ editor, align, onAlignChange, onReplace, onDelete }: ImageNodeToolbarProps) {
  const t = useTranslations('Console.editor')

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
      {/* 替换图片：从资产库选择或本地上传；阻止弹层内事件沿 React 树冒泡到图片节点 */}
      <span className="contents" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <AssetPicker accept="image/*" onSelect={([asset]) => asset && onReplace(asset.url, asset.name.replace(/\.[^/.]+$/, ''))}>
          <EditorToolbarButton label={t('image_replace')} className="h-[30px] min-w-[30px]">
            <ReplaceIcon className="size-[17px]" />
          </EditorToolbarButton>
        </AssetPicker>
      </span>
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
    </div>
  )
}
