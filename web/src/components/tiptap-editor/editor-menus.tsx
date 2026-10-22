'use client'

import type { Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'
import type { EditorToolbarState } from './use-editor-toolbar-state'
import { CheckIcon, ChevronDownIcon, ImageIcon, MinusIcon, PlusIcon, SquareCodeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { insertImage } from '@/components/tiptap-ui/image-upload-button/use-image-upload'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/link-popover'
import { setTextAlign } from '@/components/tiptap-ui/text-align-button/use-text-align'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { BLOCK_TYPES, formatShortcut, getBlockTypeDef, setBlockType, TEXT_ALIGNS } from './editor-commands'
import { EditorToolbarButton, EditorTooltip } from './editor-toolbar-button'

export type EditorMenuEntry
  = | { type: 'label', key: string, label: string }
    | { type: 'separator', key: string }
    | {
      type?: 'item'
      key: string
      label: string
      icon?: LucideIcon
      hint?: string
      shortcut?: string
      active?: boolean
      disabled?: boolean
      destructive?: boolean
      onSelect: () => void
    }

/** 渲染菜单项列表（下拉菜单、溢出菜单与块菜单共用） */
export function EditorMenuEntries({ entries }: { entries: EditorMenuEntry[] }) {
  return entries.map((entry) => {
    if (entry.type === 'label')
      return <DropdownMenuLabel key={entry.key} className="text-xs font-medium text-muted-foreground">{entry.label}</DropdownMenuLabel>
    if (entry.type === 'separator')
      return <DropdownMenuSeparator key={entry.key} />
    const Icon = entry.icon
    return (
      <DropdownMenuItem
        key={entry.key}
        disabled={entry.disabled}
        variant={entry.destructive ? 'destructive' : 'default'}
        className={cn('min-h-8 gap-2.5', entry.active && 'text-primary [&_svg:not([class*=text-])]:text-primary')}
        onSelect={entry.onSelect}
      >
        {Icon && <Icon />}
        <span className="min-w-0 flex-1 truncate">
          {entry.label}
          {entry.hint && <span className="ml-1.5 text-xs text-muted-foreground">{entry.hint}</span>}
        </span>
        {entry.shortcut && <DropdownMenuShortcut className="tracking-normal">{formatShortcut(entry.shortcut)}</DropdownMenuShortcut>}
        {entry.active && <CheckIcon className="text-primary" />}
      </DropdownMenuItem>
    )
  })
}

/** 编辑器内下拉菜单的公共内容：关闭后把焦点还给编辑器，不回到触发按钮 */
export function EditorMenuContent({
  editor,
  align = 'start',
  className,
  children,
}: {
  editor: Editor | null
  align?: 'start' | 'center' | 'end'
  className?: string
  children: React.ReactNode
}) {
  return (
    <DropdownMenuContent
      {...{ [EDITOR_FLOATING_ATTR]: '' }}
      align={align}
      sideOffset={6}
      className={cn('min-w-52 rounded-xl p-1', className)}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        editor?.commands.focus()
      }}
    >
      {children}
    </DropdownMenuContent>
  )
}

// ---------- 菜单项构建 ----------

type Translate = ReturnType<typeof useTranslations>

export function getBlockTypeEntries(editor: Editor, t: Translate, current: string, onSelect?: (id: (typeof BLOCK_TYPES)[number]['id']) => void): EditorMenuEntry[] {
  return BLOCK_TYPES.map(def => ({
    key: `block-${def.id}`,
    icon: def.icon,
    label: t(`block.${def.id}`),
    shortcut: def.shortcut,
    active: def.id === current,
    onSelect: () => (onSelect ? onSelect(def.id) : setBlockType(editor, def.id)),
  }))
}

export function getAlignEntries(editor: Editor, t: Translate, state: EditorToolbarState): EditorMenuEntry[] {
  return TEXT_ALIGNS.map(def => ({
    key: `align-${def.id}`,
    icon: def.icon,
    label: t(`align_${def.id}`),
    shortcut: def.shortcut,
    active: def.id === state.align,
    disabled: !state.canAlign,
    onSelect: () => setTextAlign(editor, def.id),
  }))
}

export function getInsertEntries(editor: Editor, t: Translate, state: EditorToolbarState): EditorMenuEntry[] {
  return [
    {
      key: 'insert-image',
      icon: ImageIcon,
      label: t('insert_image'),
      hint: t('insert_image_hint'),
      shortcut: 'mod+shift+i',
      disabled: !state.editable,
      // 沿用现有上传流程：插入图片上传块（本地上传 / 文件库选择）
      onSelect: () => insertImage(editor),
    },
    {
      key: 'insert-hr',
      icon: MinusIcon,
      label: t('insert_hr'),
      disabled: !state.editable || !editor.can().setHorizontalRule(),
      onSelect: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      key: 'insert-code',
      icon: SquareCodeIcon,
      label: t('block.codeBlock'),
      shortcut: 'mod+alt+c',
      disabled: !state.editable,
      onSelect: () => setBlockType(editor, 'codeBlock'),
    },
  ]
}

// ---------- 下拉菜单组件 ----------

/** 块类型下拉：正文 / 标题 / 列表 / 引用 / 代码块 */
export function BlockTypeMenu({ editor, state, compact }: { editor: Editor | null, state: EditorToolbarState, compact?: boolean }) {
  const t = useTranslations('Console.editor')
  if (!editor)
    return null
  const def = getBlockTypeDef(state.blockType)
  const nodeLabel = state.selectedNode ? t.has(`node.${state.selectedNode}`) ? t(`node.${state.selectedNode}`) : t('node.block') : null
  return (
    <DropdownMenu modal={false}>
      <EditorTooltip label={t('block_type')}>
        <DropdownMenuTrigger asChild>
          <EditorToolbarButton
            label={t('block_type')}
            noTooltip
            disabled={!state.editable || !!state.selectedNode}
            className={cn('justify-between gap-1 px-2', compact ? 'min-w-0' : 'min-w-[5.5rem]')}
          >
            <span className="text-left">{nodeLabel ?? t(`block.${def.id}`)}</span>
            <ChevronDownIcon className="size-3.5 opacity-50" />
          </EditorToolbarButton>
        </DropdownMenuTrigger>
      </EditorTooltip>
      <EditorMenuContent editor={editor}>
        <EditorMenuEntries entries={getBlockTypeEntries(editor, t, state.blockType)} />
      </EditorMenuContent>
    </DropdownMenu>
  )
}

/** 对齐方式下拉 */
export function AlignMenu({ editor, state }: { editor: Editor | null, state: EditorToolbarState }) {
  const t = useTranslations('Console.editor')
  if (!editor)
    return null
  const Current = (TEXT_ALIGNS.find(a => a.id === state.align) ?? TEXT_ALIGNS[0]).icon
  return (
    <DropdownMenu modal={false}>
      <EditorTooltip label={t('align')}>
        <DropdownMenuTrigger asChild>
          <EditorToolbarButton label={t('align')} noTooltip disabled={!state.canAlign}>
            <Current />
            <ChevronDownIcon className="-mr-0.5 size-3.5 opacity-50" />
          </EditorToolbarButton>
        </DropdownMenuTrigger>
      </EditorTooltip>
      <EditorMenuContent editor={editor}>
        <EditorMenuEntries entries={getAlignEntries(editor, t, state)} />
      </EditorMenuContent>
    </DropdownMenu>
  )
}

/** 插入下拉：图片（上传）、分割线、代码块 */
export function InsertMenu({ editor, state }: { editor: Editor | null, state: EditorToolbarState }) {
  const t = useTranslations('Console.editor')
  if (!editor)
    return null
  return (
    <DropdownMenu modal={false}>
      <EditorTooltip label={t('insert_tip')}>
        <DropdownMenuTrigger asChild>
          <EditorToolbarButton label={t('insert')} noTooltip disabled={!state.editable} className="gap-1 px-2">
            <PlusIcon className="size-[17px]" />
            <span>{t('insert')}</span>
            <ChevronDownIcon className="-mr-0.5 size-3.5 opacity-50" />
          </EditorToolbarButton>
        </DropdownMenuTrigger>
      </EditorTooltip>
      <EditorMenuContent editor={editor}>
        <EditorMenuEntries entries={getInsertEntries(editor, t, state)} />
      </EditorMenuContent>
    </DropdownMenu>
  )
}
