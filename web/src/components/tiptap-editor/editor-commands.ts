import type { ChainedCommands, Editor } from '@tiptap/react'
import type { LucideIcon } from 'lucide-react'
import type { TextAlign } from '@/components/tiptap-ui/text-align-button/use-text-align'
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  PilcrowIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignJustifyIcon,
  TextAlignStartIcon,
  TextQuoteIcon,
  UnderlineIcon,
} from 'lucide-react'
import { isMac, parseShortcutKeys } from '@/lib/tiptap-utils'

/**
 * 编辑器命令注册表：固定工具栏、气泡菜单、溢出菜单、块菜单与斜杠命令共用
 * 文案统一在 Console.editor 命名空间下，按 id 取 key
 */

export type BlockTypeId
  = | 'paragraph'
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'bulletList'
    | 'orderedList'
    | 'taskList'
    | 'blockquote'
    | 'codeBlock'

export interface BlockTypeDef {
  id: BlockTypeId
  icon: LucideIcon
  shortcut: string
  level?: 1 | 2 | 3 | 4
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  { id: 'paragraph', icon: PilcrowIcon, shortcut: 'mod+alt+0' },
  { id: 'h1', icon: Heading1Icon, shortcut: 'mod+alt+1', level: 1 },
  { id: 'h2', icon: Heading2Icon, shortcut: 'mod+alt+2', level: 2 },
  { id: 'h3', icon: Heading3Icon, shortcut: 'mod+alt+3', level: 3 },
  { id: 'h4', icon: Heading4Icon, shortcut: 'mod+alt+4', level: 4 },
  { id: 'bulletList', icon: ListIcon, shortcut: 'mod+shift+8' },
  { id: 'orderedList', icon: ListOrderedIcon, shortcut: 'mod+shift+7' },
  { id: 'taskList', icon: ListTodoIcon, shortcut: 'mod+shift+9' },
  { id: 'blockquote', icon: TextQuoteIcon, shortcut: 'mod+shift+b' },
  { id: 'codeBlock', icon: SquareCodeIcon, shortcut: 'mod+alt+c' },
]

export function getBlockTypeDef(id: BlockTypeId): BlockTypeDef {
  return BLOCK_TYPES.find(b => b.id === id) ?? BLOCK_TYPES[0]
}

/** 当前光标所在块的类型（列表、引用等容器优先于其中的段落） */
export function getActiveBlockType(editor: Editor | null): BlockTypeId {
  if (!editor)
    return 'paragraph'
  if (editor.isActive('codeBlock'))
    return 'codeBlock'
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive('heading', { level }))
      return `h${level}`
  }
  if (editor.isActive('taskList'))
    return 'taskList'
  if (editor.isActive('orderedList'))
    return 'orderedList'
  if (editor.isActive('bulletList'))
    return 'bulletList'
  if (editor.isActive('blockquote'))
    return 'blockquote'
  return 'paragraph'
}

/**
 * 设置块类型：先 clearNodes() 归一为段落（跳出列表/引用），再应用目标类型，
 * 从任意块转换到任意块都能成功；prep 可在链首插入额外步骤（如删除斜杠命令的 “/query”）
 */
export function setBlockType(
  editor: Editor,
  id: BlockTypeId,
  options: { prep?: (chain: ChainedCommands) => ChainedCommands, force?: boolean } = {},
) {
  const { prep, force = false } = options
  let chain = editor.chain().focus()
  if (prep)
    chain = prep(chain)
  if (!force && getActiveBlockType(editor) === id) {
    chain.run()
    return
  }
  chain = chain.clearNodes()
  const def = getBlockTypeDef(id)
  if (def.level)
    chain = chain.setHeading({ level: def.level })
  else if (id === 'bulletList')
    chain = chain.toggleBulletList()
  else if (id === 'orderedList')
    chain = chain.toggleOrderedList()
  else if (id === 'taskList')
    chain = chain.toggleTaskList()
  else if (id === 'blockquote')
    chain = chain.toggleBlockquote()
  else if (id === 'codeBlock')
    chain = chain.setCodeBlock()
  chain.run()
}

export type InlineMarkId = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'superscript' | 'subscript'

export const INLINE_MARKS: Record<InlineMarkId, { icon: LucideIcon, shortcut: string }> = {
  bold: { icon: BoldIcon, shortcut: 'mod+b' },
  italic: { icon: ItalicIcon, shortcut: 'mod+i' },
  underline: { icon: UnderlineIcon, shortcut: 'mod+u' },
  strike: { icon: StrikethroughIcon, shortcut: 'mod+shift+s' },
  code: { icon: CodeIcon, shortcut: 'mod+e' },
  superscript: { icon: SuperscriptIcon, shortcut: 'mod+.' },
  subscript: { icon: SubscriptIcon, shortcut: 'mod+,' },
}

// 固定工具栏与气泡菜单中直接展示的标记
export const PRIMARY_MARKS: InlineMarkId[] = ['bold', 'italic', 'underline', 'strike', 'code']

export const TEXT_ALIGNS: { id: TextAlign, icon: LucideIcon, shortcut: string }[] = [
  { id: 'left', icon: TextAlignStartIcon, shortcut: 'mod+shift+l' },
  { id: 'center', icon: TextAlignCenterIcon, shortcut: 'mod+shift+e' },
  { id: 'right', icon: TextAlignEndIcon, shortcut: 'mod+shift+r' },
  { id: 'justify', icon: TextAlignJustifyIcon, shortcut: 'mod+shift+j' },
]

export function getActiveTextAlign(editor: Editor | null): TextAlign {
  if (!editor)
    return 'left'
  return TEXT_ALIGNS.find(a => a.id !== 'left' && editor.isActive({ textAlign: a.id }))?.id ?? 'left'
}

/** 快捷键显示：mod+shift+z → ⌘⇧Z / Ctrl+Shift+Z */
export function formatShortcut(shortcut: string | undefined): string {
  if (!shortcut)
    return ''
  const keys = parseShortcutKeys({ shortcutKeys: shortcut })
  return keys.join(isMac() ? '' : '+')
}
