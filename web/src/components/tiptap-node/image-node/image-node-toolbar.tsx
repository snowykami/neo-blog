'use client'

import type { Editor } from '@tiptap/react'
import type { useTranslations as UseTranslations } from 'next-intl'
import type { ImageWidthPreset } from './image-width'
import type { EditorMenuEntry } from '@/components/tiptap-editor/editor-menus'
import { DownloadIcon, MoveHorizontalIcon, ReplaceIcon, TextAlignCenterIcon, TextAlignEndIcon, TextAlignStartIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AssetPicker } from '@/components/common/asset-picker'
import { EditorMenuContent, EditorMenuEntries } from '@/components/tiptap-editor/editor-menus'
import { EditorToolbarButton, EditorToolbarSeparator, EditorTooltip } from '@/components/tiptap-editor/editor-toolbar-button'
import { downloadSelectedImage } from '@/components/tiptap-ui/image-download-button/use-image-download'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IMAGE_TOOLBAR_ATTR } from './image-node-constants'
import { IMAGE_WIDTH_PRESETS } from './image-width'

export type ImageAlign = 'left' | 'center' | 'right'

const ALIGNS: { id: ImageAlign, icon: typeof TextAlignStartIcon }[] = [
  { id: 'left', icon: TextAlignStartIcon },
  { id: 'center', icon: TextAlignCenterIcon },
  { id: 'right', icon: TextAlignEndIcon },
]

// 当前宽度：预设、拖动得到的像素宽度（custom）或原始尺寸（null）
export type ImageWidthValue = ImageWidthPreset | 'custom' | null

/** 宽度菜单项（图片浮动工具栏与右键菜单共用）：五个预设与原始尺寸，当前项打勾 */
export function getImageWidthEntries(t: ReturnType<typeof UseTranslations>, current: ImageWidthValue, onSelect: (preset: ImageWidthPreset | null) => void): EditorMenuEntry[] {
  return [
    ...IMAGE_WIDTH_PRESETS.map(preset => ({
      key: `image-width-${preset}`,
      label: t(`image_width_${preset.replace('.', '_')}`),
      hint: `${preset}%`,
      active: current === preset,
      onSelect: () => onSelect(preset),
    })),
    { type: 'separator' as const, key: 'image-width-sep' },
    { key: 'image-width-original', label: t('image_width_original'), active: current === null, onSelect: () => onSelect(null) },
  ]
}

export interface ImageNodeToolbarProps {
  editor: Editor
  align: ImageAlign
  onAlignChange: (align: ImageAlign) => void
  width: ImageWidthValue
  onWidthChange: (preset: ImageWidthPreset | null) => void
  onReplace: (src: string, name: string) => void
  onDelete: () => void
}

/**
 * 图片浮动工具栏：附着在选中的图片上（对齐 / 宽度 / 替换 / 下载 / 删除），不占用主工具栏
 */
export function ImageNodeToolbar({ editor, align, onAlignChange, width, onWidthChange, onReplace, onDelete }: ImageNodeToolbarProps) {
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
      {/* 宽度预设：阻止弹层内事件沿 React 树冒泡到图片节点 */}
      <span className="contents" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <DropdownMenu modal={false}>
          <EditorTooltip label={t('image_width')}>
            <DropdownMenuTrigger asChild>
              <EditorToolbarButton label={t('image_width')} noTooltip className="h-[30px] min-w-[30px] px-2 tabular-nums">
                <MoveHorizontalIcon className="size-[17px]" />
                <span className="text-xs">{width === 'custom' ? t('image_width_custom') : width ? `${width}%` : t('image_width_original')}</span>
              </EditorToolbarButton>
            </DropdownMenuTrigger>
          </EditorTooltip>
          <EditorMenuContent editor={editor} align="center" className="min-w-44">
            <EditorMenuEntries entries={getImageWidthEntries(t, width, onWidthChange)} />
          </EditorMenuContent>
        </DropdownMenu>
      </span>
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
