'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'
import type { EditorMenuEntry } from './editor-menus'
import type { EditorToolbarActions } from './editor-toolbar'
import type { AIWriterOpenOptions } from './use-ai-writer'
import type { ImageAlign } from '@/components/tiptap-node/image-node/image-node-toolbar'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import {
  CheckIcon,
  ClipboardPasteIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LinkIcon,
  MessageSquareTextIcon,
  PilcrowIcon,
  RemoveFormattingIcon,
  Repeat2Icon,
  ReplaceIcon,
  ScissorsIcon,
  SparklesIcon,
  TableIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignStartIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { AssetPicker } from '@/components/common/asset-picker'
import { downloadSelectedImage } from '@/components/tiptap-ui/image-download-button/use-image-download'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/link-popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { formatShortcut, INLINE_MARKS, setBlockType } from './editor-commands'
import { getAIEntries, getBlockTypeEntries, getInsertEntries, getTableEntries } from './editor-menus'
import { markEntry } from './editor-toolbar'
import { useEditorToolbarState } from './use-editor-toolbar-state'

type ContextEntry
  = | EditorMenuEntry
    | { type: 'sub', key: string, label: string, icon: LucideIcon, disabled?: boolean, entries: EditorMenuEntry[] }

/**
 * 右键位置的上下文：
 * - selection：在文字选区内右键
 * - cursor：光标处（可能位于表格内）
 * - image / codeBlock：在图片、代码块上右键
 */
type MenuContext
  = | { type: 'selection' }
    | { type: 'cursor' }
    | { type: 'image', pos: number, node: PMNode }
    | { type: 'codeBlock', pos: number, node: PMNode }

// 代码块语言（lowlight common 中的名称），null 表示纯文本
const CODE_LANGUAGES: [string | null, string][] = [
  [null, ''],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['bash', 'Bash'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['xml', 'HTML / XML'],
  ['css', 'CSS'],
  ['sql', 'SQL'],
  ['markdown', 'Markdown'],
  ['diff', 'Diff'],
]

const IMAGE_ALIGNS: { id: ImageAlign, icon: LucideIcon }[] = [
  { id: 'left', icon: TextAlignStartIcon },
  { id: 'center', icon: TextAlignCenterIcon },
  { id: 'right', icon: TextAlignEndIcon },
]

function useCoarsePointer() {
  return React.useSyncExternalStore(
    () => () => {},
    () => window.matchMedia('(hover: none)').matches,
    () => false,
  )
}

/** 根据选区（键盘打开时）或点击位置（鼠标右键时）确定上下文，并把选区移到对应位置 */
function resolveContext(editor: Editor, saved: Selection, point: { x: number, y: number } | null): MenuContext {
  const { state, view } = editor
  const select = (selection: Selection) => {
    if (!selection.eq(editor.state.selection))
      view.dispatch(editor.state.tr.setSelection(selection))
  }
  const nodeContext = (pos: number): MenuContext | null => {
    const node = state.doc.nodeAt(pos)
    if (node?.type.name === 'image')
      return { type: 'image', pos, node }
    return null
  }
  const codeContext = (pos: number): MenuContext | null => {
    const $pos = state.doc.resolve(pos)
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth)
      if (node.type.name === 'codeBlock')
        return { type: 'codeBlock', pos: $pos.before(depth), node }
    }
    return null
  }

  if (!point) {
    if (saved instanceof NodeSelection)
      return nodeContext(saved.from) ?? { type: 'cursor' }
    if (!saved.empty)
      return { type: 'selection' }
    return codeContext(saved.head) ?? { type: 'cursor' }
  }

  const hit = view.posAtCoords({ left: point.x, top: point.y })
  if (!hit) {
    select(saved)
    return saved.empty ? { type: 'cursor' } : { type: 'selection' }
  }
  // 在已有文字选区内右键：针对选区（浏览器可能已在按下右键时改变了选区，这里恢复）
  if (!saved.empty && !(saved instanceof NodeSelection) && hit.pos >= saved.from && hit.pos <= saved.to) {
    select(saved)
    return { type: 'selection' }
  }
  if (hit.inside >= 0) {
    const context = nodeContext(hit.inside)
    if (context) {
      select(NodeSelection.create(state.doc, hit.inside))
      return context
    }
  }
  select(TextSelection.near(state.doc.resolve(hit.pos)))
  return codeContext(hit.pos) ?? { type: 'cursor' }
}

export interface EditorContextMenuProps {
  editor: Editor
  actions: EditorToolbarActions
  children: React.ReactNode
}

/**
 * 编辑器右键菜单：
 * - 有选区：AI 润色、剪切 / 复制 / 粘贴、格式、转换、链接与注释
 * - 无选区：AI 帮写、插入（图片从资产库选择、代码块、表格、分割线）、转换、粘贴；表格内附加行列操作
 * - 图片 / 代码块：节点专属操作
 * 支持键盘（菜单键 / Shift+F10）；按住 Shift 右键或触屏设备保留浏览器原生菜单
 */
export function EditorContextMenu({ editor, actions, children }: EditorContextMenuProps) {
  const t = useTranslations('Console.editor')
  const state = useEditorToolbarState(editor)
  const coarsePointer = useCoarsePointer()
  const [context, setContext] = React.useState<MenuContext>({ type: 'cursor' })
  const [picker, setPicker] = React.useState<{ mode: 'insert' } | { mode: 'replace', pos: number } | null>(null)
  // 按下右键时的选区：浏览器与编辑器可能在 contextmenu 之前就改变了选区
  const savedSelectionRef = React.useRef<Selection | null>(null)
  // 键盘打开时派发的合成事件，按当前选区确定上下文
  const keyboardRef = React.useRef(false)
  // 菜单项打开了其他浮层（AI 面板、资产库、链接弹层）时，关闭菜单后不把焦点还给编辑器
  const skipFocusRef = React.useRef(false)

  /** 在光标位置派发 contextmenu，由 Radix 在该位置打开菜单 */
  const openAtCaret = React.useCallback(() => {
    if (editor.isDestroyed)
      return
    const { view, state: editorState } = editor
    const coords = view.coordsAtPos(editorState.selection.head)
    keyboardRef.current = true
    view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: coords.left, clientY: coords.bottom, button: 2 }))
  }, [editor])

  // 键盘：Shift+F10 / 菜单键
  React.useEffect(() => {
    const dom = editor.view.dom
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        openAtCaret()
      }
    }
    dom.addEventListener('keydown', onKeyDown)
    return () => dom.removeEventListener('keydown', onKeyDown)
  }, [editor, openAtCaret])

  const isNativeTarget = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    return event.shiftKey
      || !editor.isEditable
      || !editor.view.dom.contains(target)
      // 图片说明等输入框保留原生菜单
      || !!target.closest('input, textarea')
  }

  const handleMouseDownCapture = (event: React.MouseEvent) => {
    if (event.button !== 2 || coarsePointer || isNativeTarget(event))
      return
    savedSelectionRef.current = editor.state.selection
    // 阻止浏览器在右键时选中单词或移动光标
    event.preventDefault()
  }

  const handleContextMenuCapture = (event: React.MouseEvent) => {
    const keyboard = keyboardRef.current
    keyboardRef.current = false
    if (!keyboard && (coarsePointer || isNativeTarget(event))) {
      // 交给浏览器原生菜单：阻止事件到达 Radix 的触发器
      event.stopPropagation()
      return
    }
    // 键盘触发的原生事件（坐标不可靠）改为在光标处重新派发
    if (!keyboard && event.button !== 2) {
      event.preventDefault()
      event.stopPropagation()
      openAtCaret()
      return
    }
    const saved = savedSelectionRef.current ?? editor.state.selection
    savedSelectionRef.current = null
    setContext(resolveContext(editor, saved, keyboard ? null : { x: event.clientX, y: event.clientY }))
  }

  // ---------- 操作 ----------
  const withFloating = (fn: () => void) => () => {
    skipFocusRef.current = true
    fn()
  }

  const clipboardCommand = (command: 'copy' | 'cut') => {
    editor.view.focus()
    let ok = false
    try {
      // 走编辑器自身的复制逻辑，保留格式
      ok = document.execCommand(command)
    }
    catch {}
    if (ok)
      return
    const { from, to } = editor.state.selection
    navigator.clipboard.writeText(editor.state.doc.textBetween(from, to, '\n\n'))
      .then(() => {
        if (command === 'cut')
          editor.chain().focus().deleteSelection().run()
      })
      .catch(() => toast.error(t('context.copy_failed')))
  }

  const paste = async () => {
    try {
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes('text/html')) {
            const html = await (await item.getType('text/html')).text()
            editor.view.focus()
            editor.view.pasteHTML(html)
            return
          }
        }
      }
      const text = await navigator.clipboard.readText()
      editor.view.focus()
      editor.view.pasteText(text)
    }
    catch {
      toast.error(t('context.paste_failed', { shortcut: formatShortcut('mod+v') }))
    }
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => toast.success(t('context.copied')))
      .catch(() => toast.error(t('context.copy_failed')))
  }

  const selectNode = (pos: number) => editor.chain().focus().setNodeSelection(pos)

  // ---------- 菜单项 ----------
  const clipboardEntries = (withCut: boolean): EditorMenuEntry[] => [
    ...(withCut
      ? [
          { key: 'cut', icon: ScissorsIcon, label: t('context.cut'), shortcut: 'mod+x', onSelect: () => clipboardCommand('cut') },
          { key: 'copy', icon: CopyIcon, label: t('context.copy'), shortcut: 'mod+c', onSelect: () => clipboardCommand('copy') },
        ]
      : []),
    { key: 'paste', icon: ClipboardPasteIcon, label: t('context.paste'), shortcut: 'mod+v', onSelect: () => void paste() },
  ]

  const turnInto = (): ContextEntry => ({
    type: 'sub',
    key: 'turn-into',
    icon: Repeat2Icon,
    label: t('context.turn_into'),
    disabled: !state.editable || !!state.selectedNode,
    entries: getBlockTypeEntries(editor, t, state.blockType),
  })

  const openAI = (options: AIWriterOpenOptions) => {
    skipFocusRef.current = true
    actions.openAI(options)
  }
  const entries: ContextEntry[] = []
  const tableGroup = (): ContextEntry[] => state.inTable
    ? [{ type: 'sub', key: 'table', icon: TableIcon, label: t('context.table'), entries: getTableEntries(editor, t) }]
    : []

  switch (context.type) {
    case 'selection': {
      entries.push(
        { type: 'sub', key: 'ai-rewrite', icon: SparklesIcon, label: t('ai.rewrite'), entries: getAIEntries(t, 'rewrite', openAI) },
        { type: 'separator', key: 'sep-ai' },
        ...clipboardEntries(true),
        { type: 'separator', key: 'sep-clipboard' },
      )
      if (!state.inCodeBlock) {
        entries.push(
          {
            type: 'sub',
            key: 'format',
            icon: TypeIcon,
            label: t('context.format'),
            entries: [
              ...(Object.keys(INLINE_MARKS) as (keyof typeof INLINE_MARKS)[]).map(id => markEntry(editor, t, state, id)),
              { type: 'separator', key: 'sep-clear' },
              { key: 'clear', icon: RemoveFormattingIcon, label: t('clear_formatting'), shortcut: 'mod+\\', onSelect: () => editor.chain().focus().unsetAllMarks().run() },
            ],
          },
          turnInto(),
          { key: 'link', icon: LinkIcon, label: t('link'), shortcut: 'mod+k', disabled: !state.canLink, onSelect: withFloating(actions.openLink) },
          { key: 'annotation', icon: MessageSquareTextIcon, label: t('annotation'), shortcut: 'mod+alt+m', disabled: !state.canAnnotate, onSelect: withFloating(actions.openAnnotation) },
        )
      }
      entries.push(...tableGroup())
      break
    }
    case 'image': {
      const { pos, node } = context
      const src = String(node.attrs.src ?? '')
      const align = (node.attrs['data-align'] as ImageAlign | null) ?? 'center'
      entries.push(
        { key: 'image-replace', icon: ReplaceIcon, label: t('context.image_replace'), onSelect: withFloating(() => setPicker({ mode: 'replace', pos })) },
        {
          type: 'sub',
          key: 'image-align',
          icon: TextAlignCenterIcon,
          label: t('align'),
          entries: IMAGE_ALIGNS.map(({ id, icon }) => ({
            key: `image-align-${id}`,
            icon,
            label: t(`image_align_${id}`),
            active: align === id,
            onSelect: () => selectNode(pos).updateAttributes('image', { 'data-align': id }).run(),
          })),
        },
        { key: 'image-copy-url', icon: LinkIcon, label: t('context.image_copy_url'), disabled: !src, onSelect: () => copyText(new URL(src, window.location.href).href) },
        { key: 'image-open', icon: ExternalLinkIcon, label: t('context.image_open'), disabled: !src, onSelect: () => window.open(src, '_blank', 'noopener,noreferrer') },
        {
          key: 'image-download',
          icon: DownloadIcon,
          label: t('image_download'),
          shortcut: 'mod+shift+d',
          disabled: !src,
          onSelect: () => {
            selectNode(pos).run()
            void downloadSelectedImage(editor)
          },
        },
        { type: 'separator', key: 'sep-image' },
        { key: 'image-delete', icon: Trash2Icon, label: t('image_delete'), destructive: true, onSelect: () => selectNode(pos).deleteSelection().run() },
      )
      break
    }
    case 'codeBlock': {
      const { pos, node } = context
      const language = (node.attrs.language as string | null) || null
      entries.push(
        { key: 'ai-write', icon: SparklesIcon, label: t('context.ai_write'), shortcut: 'mod+j', onSelect: () => openAI({ mode: 'write' }) },
        { type: 'separator', key: 'sep-ai' },
        { key: 'code-copy', icon: CopyIcon, label: t('context.code_copy'), onSelect: () => copyText(node.textContent) },
        {
          type: 'sub',
          key: 'code-language',
          icon: CodeIcon,
          label: t('context.code_language'),
          entries: CODE_LANGUAGES.map(([id, name]) => ({
            key: `code-language-${id ?? 'plain'}`,
            label: id ? name : t('context.code_language_plain'),
            active: language === id,
            onSelect: () => editor.chain().focus().updateAttributes('codeBlock', { language: id }).run(),
          })),
        },
        { key: 'code-to-paragraph', icon: PilcrowIcon, label: t('context.code_to_paragraph'), onSelect: () => setBlockType(editor, 'paragraph') },
        ...clipboardEntries(false),
        { type: 'separator', key: 'sep-code' },
        { key: 'code-delete', icon: Trash2Icon, label: t('context.code_delete'), destructive: true, onSelect: () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run() },
      )
      break
    }
    default: {
      entries.push(
        { key: 'ai-write', icon: SparklesIcon, label: t('context.ai_write'), shortcut: 'mod+j', disabled: !state.editable, onSelect: () => openAI({ mode: 'write' }) },
        { type: 'sub', key: 'ai-presets', icon: SparklesIcon, label: t('context.ai_presets'), disabled: !state.editable, entries: getAIEntries(t, 'write', openAI).filter(entry => entry.key !== 'ai-custom' && entry.type !== 'separator') },
        { type: 'separator', key: 'sep-ai' },
        ...tableGroup(),
        { type: 'label', key: 'label-insert', label: t('insert') },
        ...getInsertEntries(editor, t, state, withFloating(() => setPicker({ mode: 'insert' }))),
        { type: 'separator', key: 'sep-insert' },
        turnInto(),
        ...clipboardEntries(false),
      )
    }
  }

  const handlePicked = (assets: { url: string, name: string }[]) => {
    const current = picker
    setPicker(null)
    const asset = assets[0]
    if (!asset || !current)
      return
    const name = asset.name.replace(/\.[^/.]+$/, '')
    if (current.mode === 'replace')
      selectNode(current.pos).updateAttributes('image', { src: asset.url, alt: name, title: name }).run()
    else
      editor.chain().focus().setImage({ src: asset.url, alt: name, title: name }).run()
  }

  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild disabled={coarsePointer}>
          <div onMouseDownCapture={handleMouseDownCapture} onContextMenuCapture={handleContextMenuCapture}>
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          {...{ [EDITOR_FLOATING_ATTR]: '' }}
          aria-label={t('context.aria')}
          className="min-w-56 rounded-xl p-1"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (skipFocusRef.current)
              skipFocusRef.current = false
            else
              editor.commands.focus()
          }}
        >
          <ContextEntries entries={entries} />
          <ContextMenuSeparator />
          <ContextMenuLabel className="px-2 py-1 text-[11px] font-normal text-muted-foreground/70">{t('context.native_hint')}</ContextMenuLabel>
        </ContextMenuContent>
      </ContextMenu>
      <AssetPicker
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open)
            setPicker(null)
        }}
        accept="image/*"
        onSelect={handlePicked}
      />
    </>
  )
}

function ContextEntries({ entries }: { entries: ContextEntry[] }) {
  return entries.map((entry) => {
    if (entry.type === 'label')
      return <ContextMenuLabel key={entry.key} className="text-xs font-medium text-muted-foreground">{entry.label}</ContextMenuLabel>
    if (entry.type === 'separator')
      return <ContextMenuSeparator key={entry.key} />
    if (entry.type === 'sub') {
      const Icon = entry.icon
      return (
        <ContextMenuSub key={entry.key}>
          <ContextMenuSubTrigger disabled={entry.disabled} className="min-h-8 gap-2.5 [&_svg:not([class*=text-])]:text-muted-foreground">
            <Icon className="size-4" />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent {...{ [EDITOR_FLOATING_ATTR]: '' }} className="max-h-[min(24rem,var(--radix-context-menu-content-available-height))] min-w-48 overflow-y-auto rounded-xl p-1">
            <ContextEntries entries={entry.entries} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      )
    }
    const Icon = entry.icon
    return (
      <ContextMenuItem
        key={entry.key}
        disabled={entry.disabled}
        variant={entry.destructive ? 'destructive' : 'default'}
        className={cn('min-h-8 gap-2.5', entry.active && 'text-primary [&_svg:not([class*=text-])]:text-primary')}
        onSelect={entry.onSelect}
      >
        {Icon ? <Icon /> : <span className="size-4" />}
        <span className="min-w-0 flex-1 truncate">
          {entry.label}
          {entry.hint && <span className="ml-1.5 text-xs text-muted-foreground">{entry.hint}</span>}
        </span>
        {entry.shortcut && <ContextMenuShortcut className="tracking-normal">{formatShortcut(entry.shortcut)}</ContextMenuShortcut>}
        {entry.active && <CheckIcon className="text-primary" />}
      </ContextMenuItem>
    )
  })
}
