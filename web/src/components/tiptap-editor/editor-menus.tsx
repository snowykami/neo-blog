'use client'

import type { Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'
import type { AIWriterOpenOptions } from './use-ai-writer'
import type { EditorToolbarState } from './use-editor-toolbar-state'
import {
  BetweenHorizontalEndIcon,
  BetweenHorizontalStartIcon,
  BetweenVerticalEndIcon,
  BetweenVerticalStartIcon,
  CheckIcon,
  ChevronDownIcon,
  Columns3Icon,
  ImageIcon,
  MinusIcon,
  PanelTopIcon,
  PencilLineIcon,
  PlusIcon,
  Rows3Icon,
  SparklesIcon,
  SquareCodeIcon,
  TableIcon,
  Trash2Icon,
} from 'lucide-react'
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
import { AI_REWRITE_PRESETS, AI_WRITE_PRESETS } from '@/models/ai-write'
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
  shouldRestoreFocus,
  children,
}: {
  editor: Editor | null
  align?: 'start' | 'center' | 'end'
  className?: string
  // 菜单项打开了其他浮层（如 AI 面板）时返回 false，不把焦点抢回编辑器
  shouldRestoreFocus?: () => boolean
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
        if (shouldRestoreFocus?.() ?? true)
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

// 插入表格的默认尺寸：3×3，首行为标题行
const TABLE_DEFAULT = { rows: 3, cols: 3, withHeaderRow: true }

/**
 * 插入类菜单项：图片、分割线、代码块、表格
 * onPickImage 传入时图片改为从资产库选择后直接插入（右键菜单），否则插入图片上传块
 */
export function getInsertEntries(editor: Editor, t: Translate, state: EditorToolbarState, onPickImage?: () => void): EditorMenuEntry[] {
  return [
    {
      key: 'insert-image',
      icon: ImageIcon,
      label: t('insert_image'),
      hint: onPickImage ? undefined : t('insert_image_hint'),
      shortcut: onPickImage ? undefined : 'mod+shift+i',
      disabled: !state.editable,
      // 沿用现有上传流程：插入图片上传块（本地上传 / 文件库选择）
      onSelect: () => (onPickImage ? onPickImage() : insertImage(editor)),
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
    {
      key: 'insert-table',
      icon: TableIcon,
      label: t('insert_table'),
      disabled: !state.editable || state.inTable || !editor.can().insertTable(TABLE_DEFAULT),
      onSelect: () => editor.chain().focus().insertTable(TABLE_DEFAULT).run(),
    },
  ]
}

/** 光标位于表格内时的行列操作 */
export function getTableEntries(editor: Editor, t: Translate): EditorMenuEntry[] {
  const can = editor.can()
  const item = (key: string, icon: LucideIcon, enabled: boolean, run: () => void, destructive = false): EditorMenuEntry => ({
    key: `table-${key}`,
    icon,
    label: t(`table.${key}`),
    disabled: !enabled,
    destructive,
    onSelect: run,
  })
  const chain = () => editor.chain().focus()
  return [
    item('add_row_before', BetweenHorizontalStartIcon, can.addRowBefore(), () => chain().addRowBefore().run()),
    item('add_row_after', BetweenHorizontalEndIcon, can.addRowAfter(), () => chain().addRowAfter().run()),
    item('add_col_before', BetweenVerticalStartIcon, can.addColumnBefore(), () => chain().addColumnBefore().run()),
    item('add_col_after', BetweenVerticalEndIcon, can.addColumnAfter(), () => chain().addColumnAfter().run()),
    { type: 'separator', key: 'table-sep-1' },
    item('toggle_header', PanelTopIcon, can.toggleHeaderRow(), () => chain().toggleHeaderRow().run()),
    item('delete_row', Rows3Icon, can.deleteRow(), () => chain().deleteRow().run(), true),
    item('delete_col', Columns3Icon, can.deleteColumn(), () => chain().deleteColumn().run(), true),
    item('delete_table', Trash2Icon, can.deleteTable(), () => chain().deleteTable().run(), true),
  ]
}

/** AI 快捷指令：帮写（光标处）或润色（选区），自定义指令打开输入面板 */
export function getAIEntries(t: Translate, mode: 'write' | 'rewrite', openAI: (options: AIWriterOpenOptions) => void, disabled = false): EditorMenuEntry[] {
  const presets = mode === 'rewrite' ? AI_REWRITE_PRESETS : AI_WRITE_PRESETS
  return [
    ...presets.map(preset => ({
      key: `ai-${preset}`,
      icon: SparklesIcon,
      label: t(`ai.preset.${preset}`),
      disabled,
      onSelect: () => openAI({ mode, preset, run: true }),
    })),
    { type: 'separator', key: 'ai-sep' },
    {
      key: 'ai-custom',
      icon: PencilLineIcon,
      label: t('ai.custom'),
      shortcut: 'mod+j',
      disabled,
      onSelect: () => openAI({ mode }),
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

/** AI 下拉：有文字选区时为润色的快捷指令，否则为帮写；自定义指令打开输入面板 */
export function AIMenu({ editor, state, openAI, compact }: {
  editor: Editor | null
  state: EditorToolbarState
  openAI: (options: AIWriterOpenOptions) => void
  compact?: boolean
}) {
  const t = useTranslations('Console.editor')
  const openedRef = React.useRef(false)
  if (!editor)
    return null
  const mode = state.textSelection ? 'rewrite' : 'write'
  const open = (options: AIWriterOpenOptions) => {
    openedRef.current = true
    openAI(options)
  }
  return (
    <DropdownMenu modal={false}>
      <EditorTooltip label={t('ai.open_hint')}>
        <DropdownMenuTrigger asChild>
          <EditorToolbarButton label={t('ai.open')} noTooltip disabled={!state.editable} className="gap-1 px-2 text-primary hover:text-primary">
            <SparklesIcon className="size-[17px]" />
            {!compact && <span>{t('ai.short')}</span>}
            <ChevronDownIcon className="-mr-0.5 size-3.5 opacity-50" />
          </EditorToolbarButton>
        </DropdownMenuTrigger>
      </EditorTooltip>
      <EditorMenuContent
        editor={editor}
        shouldRestoreFocus={() => {
          const restore = !openedRef.current
          openedRef.current = false
          return restore
        }}
      >
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t(mode === 'rewrite' ? 'ai.rewrite' : 'ai.write')}</DropdownMenuLabel>
        <EditorMenuEntries entries={getAIEntries(t, mode, open)} />
      </EditorMenuContent>
    </DropdownMenu>
  )
}
