'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { BlockTypeId } from './editor-commands'
import type { EditorMenuEntry } from './editor-menus'
import { offset } from '@floating-ui/react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, GripVerticalIcon, PlusIcon, Repeat2Icon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { setBlockType } from './editor-commands'
import { EditorMenuContent, EditorMenuEntries, getBlockTypeEntries } from './editor-menus'
import { EditorTooltip } from './editor-toolbar-button'

// 需保持引用稳定，否则 DragHandle 会重复注册插件
const COMPUTE_POSITION_CONFIG = {
  placement: 'left-start' as const,
  strategy: 'absolute' as const,
  middleware: [offset({ mainAxis: 6, crossAxis: 0 })],
}

const CONVERTIBLE_CONTAINERS = ['bulletList', 'orderedList', 'taskList', 'blockquote']

interface HoveredBlock {
  node: PMNode
  pos: number
}

/** 选中整块的文字内容（用于“转换为…”） */
function selectBlockContent(editor: Editor, block: HoveredBlock) {
  const { doc } = editor.state
  const from = TextSelection.near(doc.resolve(block.pos + 1), 1).from
  const to = TextSelection.near(doc.resolve(block.pos + block.node.nodeSize - 1), -1).to
  editor.chain().focus().setTextSelection({ from: Math.min(from, to), to: Math.max(from, to) }).run()
}

/** 顶层块上移 / 下移 */
function moveBlock(editor: Editor, block: HoveredBlock, dir: -1 | 1) {
  const { state } = editor
  const node = state.doc.nodeAt(block.pos)
  if (!node)
    return
  const index = state.doc.resolve(block.pos).index(0)
  if ((dir < 0 && index === 0) || (dir > 0 && index >= state.doc.childCount - 1))
    return
  const tr = state.tr
  let target: number
  if (dir < 0) {
    target = block.pos - state.doc.child(index - 1).nodeSize
    tr.delete(block.pos, block.pos + node.nodeSize).insert(target, node)
  }
  else {
    const next = state.doc.child(index + 1)
    tr.delete(block.pos, block.pos + node.nodeSize)
    target = block.pos + next.nodeSize
    tr.insert(target, node)
  }
  tr.setSelection(node.isTextblock || !node.isAtom
    ? TextSelection.near(tr.doc.resolve(target + 1))
    : NodeSelection.create(tr.doc, target))
  editor.view.dispatch(tr.scrollIntoView())
  editor.commands.focus()
}

/**
 * 块手柄：悬停块左侧出现 “+”（插入 / 唤出斜杠命令）与 “⋮⋮”（拖动移动，点击打开块菜单）
 * 拖动基于官方 @tiptap/extension-drag-handle-react；移动端与触屏设备隐藏（见 editor-content.scss）
 */
export function EditorBlockHandle({ editor, readOnly }: { editor: Editor, readOnly: boolean }) {
  const t = useTranslations('Console.editor')
  const [block, setBlock] = React.useState<HoveredBlock | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const onNodeChange = React.useCallback(({ node, pos }: { node: PMNode | null, pos: number }) => {
    setBlock(prev => (prev?.pos === pos && prev.node === node ? prev : node ? { node, pos } : null))
  }, [])

  // 菜单打开期间锁定手柄位置
  // 菜单打开时点击手柄会先触发“点击外部关闭”，记录关闭时间，避免随后的 click 又把菜单打开
  const closedAtRef = React.useRef(0)
  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open)
    if (!open)
      closedAtRef.current = Date.now()
    // 使用 React 组件时没有注册扩展命令，直接通过 meta 通知拖拽手柄插件
    if (!editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', open).setMeta('addToHistory', false))
  }
  const toggleMenu = () => {
    if (!menuOpen && Date.now() - closedAtRef.current < 300)
      return
    handleMenuOpenChange(!menuOpen)
  }

  const insertBelow = () => {
    if (!block)
      return
    const { node, pos } = block
    // 空段落直接输入 “/”，否则在块后插入新段落并输入 “/”，从而唤出斜杠命令
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      editor.chain().focus().setTextSelection(pos + 1).insertContent('/').run()
    }
    else {
      const end = pos + node.nodeSize
      editor.chain().focus().insertContentAt(end, { type: 'paragraph', content: [{ type: 'text', text: '/' }] }).setTextSelection(end + 2).run()
    }
  }

  const nodeTypeLabel = (node: PMNode) => {
    const name = node.type.name
    if (name === 'heading')
      return t(`block.h${node.attrs.level}`)
    if (t.has(`block.${name}`))
      return t(`block.${name}`)
    if (t.has(`node.${name}`))
      return t(`node.${name}`)
    return t('node.block')
  }

  const entries: EditorMenuEntry[] = []
  if (block) {
    const { node, pos } = block
    const convertible = node.isTextblock || CONVERTIBLE_CONTAINERS.includes(node.type.name)
    const index = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size)).index(0)
    entries.push({ type: 'label', key: 'label-turn', label: t('turn_into_current', { type: nodeTypeLabel(node) }) })
    if (convertible) {
      entries.push(...getBlockTypeEntries(editor, t, '', (id: BlockTypeId) => {
        selectBlockContent(editor, block)
        setBlockType(editor, id)
      }))
    }
    else {
      entries.push({ key: 'not-convertible', icon: Repeat2Icon, label: t('not_convertible'), disabled: true, onSelect: () => {} })
    }
    entries.push(
      { type: 'separator', key: 'sep-1' },
      {
        key: 'duplicate',
        icon: CopyIcon,
        label: t('duplicate'),
        hint: t('duplicate_hint'),
        onSelect: () => editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run(),
      },
      { key: 'move-up', icon: ArrowUpIcon, label: t('move_up'), disabled: index === 0, onSelect: () => moveBlock(editor, block, -1) },
      { key: 'move-down', icon: ArrowDownIcon, label: t('move_down'), disabled: index >= editor.state.doc.childCount - 1, onSelect: () => moveBlock(editor, block, 1) },
      { type: 'separator', key: 'sep-2' },
      {
        key: 'delete',
        icon: Trash2Icon,
        label: t('delete'),
        destructive: true,
        onSelect: () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(),
      },
    )
  }

  if (readOnly)
    return null

  return (
    <DragHandle editor={editor} className="neo-drag-handle" computePositionConfig={COMPUTE_POSITION_CONFIG} onNodeChange={onNodeChange}>
      <div className="flex items-center">
        <EditorTooltip label={t('block_add')} side="top">
          <button
            type="button"
            aria-label={t('block_add')}
            className="grid h-7 w-6 place-items-center rounded-md text-foreground/30 transition-colors hover:bg-accent hover:text-foreground/75"
            onMouseDown={e => e.preventDefault()}
            onClick={insertBelow}
          >
            <PlusIcon className="size-4" />
          </button>
        </EditorTooltip>
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={handleMenuOpenChange}>
          <span className="relative">
            {/* 菜单锚点：不接收指针事件，避免按下即打开菜单而影响拖动；点击手柄时再打开 */}
            <DropdownMenuTrigger asChild>
              <span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-0" />
            </DropdownMenuTrigger>
            <EditorTooltip label={t('block_drag')} side="top">
              <button
                type="button"
                aria-label={t('block_menu')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                data-state={menuOpen ? 'open' : 'closed'}
                className="grid h-7 w-6 cursor-grab place-items-center rounded-md text-foreground/30 transition-colors hover:bg-accent hover:text-foreground/75 active:cursor-grabbing data-[state=open]:bg-accent data-[state=open]:text-foreground/75"
                onClick={toggleMenu}
              >
                <GripVerticalIcon className="size-4" />
              </button>
            </EditorTooltip>
          </span>
          <EditorMenuContent editor={editor}>
            <EditorMenuEntries entries={entries} />
          </EditorMenuContent>
        </DropdownMenu>
      </div>
    </DragHandle>
  )
}
