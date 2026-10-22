'use client'

import type { Editor } from '@tiptap/react'
import type { BlockTypeId, InlineMarkId } from './editor-commands'
import type { TextAlign } from '@/components/tiptap-ui/text-align-button/use-text-align'
import { NodeSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { ANNOTATION_MARK } from '@/components/tiptap-extension/annotation-constants'
import { canColorHighlight } from '@/components/tiptap-ui/color-highlight-button/use-color-highlight'
import { canColorText } from '@/components/tiptap-ui/color-text-button/use-color-text'
import { canSetLink } from '@/components/tiptap-ui/link-popover/use-link-popover'
import { canToggleMark } from '@/components/tiptap-ui/mark-button/use-mark'
import { canExecuteUndoRedoAction } from '@/components/tiptap-ui/undo-redo-button/use-undo-redo'
import { getActiveMarkAttrs } from '@/lib/tiptap-advanced-utils'
import { getActiveBlockType, getActiveTextAlign, INLINE_MARKS } from './editor-commands'

export interface EditorToolbarState {
  editable: boolean
  canUndo: boolean
  canRedo: boolean
  blockType: BlockTypeId
  // 选中图片、分割线等节点时的节点名
  selectedNode: string | null
  // 有非空的文字选区
  textSelection: boolean
  marks: Record<InlineMarkId, { active: boolean, can: boolean }>
  align: TextAlign
  canAlign: boolean
  textColor: string | null
  highlightColor: string | null
  canColor: boolean
  isLink: boolean
  canLink: boolean
  isAnnotation: boolean
  canAnnotate: boolean
  inCodeBlock: boolean
  codeLanguage: string | null
  inTable: boolean
}

const EMPTY_STATE: EditorToolbarState = {
  editable: false,
  canUndo: false,
  canRedo: false,
  blockType: 'paragraph',
  selectedNode: null,
  textSelection: false,
  marks: Object.fromEntries(Object.keys(INLINE_MARKS).map(id => [id, { active: false, can: false }])) as EditorToolbarState['marks'],
  align: 'left',
  canAlign: false,
  textColor: null,
  highlightColor: null,
  canColor: false,
  isLink: false,
  canLink: false,
  isAnnotation: false,
  canAnnotate: false,
  inCodeBlock: false,
  codeLanguage: null,
  inTable: false,
}

/**
 * 订阅编辑器状态，供工具栏、气泡菜单与状态栏渲染（只有结果变化时才重新渲染）
 */
export function useEditorToolbarState(editor: Editor | null): EditorToolbarState {
  return useEditorState({
    editor,
    selector: ({ editor: ed }): EditorToolbarState => {
      if (!ed)
        return EMPTY_STATE
      const { selection } = ed.state
      const editable = ed.isEditable
      const inCodeBlock = ed.isActive('codeBlock')
      const marks = Object.fromEntries(
        (Object.keys(INLINE_MARKS) as InlineMarkId[]).map(id => [id, { active: editable && ed.isActive(id), can: canToggleMark(ed, id) }]),
      ) as EditorToolbarState['marks']
      return {
        editable,
        canUndo: canExecuteUndoRedoAction(ed, 'undo'),
        canRedo: canExecuteUndoRedoAction(ed, 'redo'),
        blockType: getActiveBlockType(ed),
        selectedNode: selection instanceof NodeSelection ? selection.node.type.name : null,
        textSelection: !selection.empty && !(selection instanceof NodeSelection),
        marks,
        align: getActiveTextAlign(ed),
        canAlign: editable && !(selection instanceof NodeSelection) && ed.can().setTextAlign('left'),
        textColor: (getActiveMarkAttrs(ed, 'textStyle')?.color as string | undefined) ?? null,
        highlightColor: ed.isActive('highlight') ? ((getActiveMarkAttrs(ed, 'highlight')?.color as string | undefined) ?? null) : null,
        canColor: !inCodeBlock && (canColorText(ed) || canColorHighlight(ed)),
        isLink: editable && ed.isActive('link'),
        canLink: !inCodeBlock && canSetLink(ed),
        isAnnotation: editable && ed.isActive(ANNOTATION_MARK),
        canAnnotate: editable && !inCodeBlock && (ed.isActive(ANNOTATION_MARK) || !selection.empty),
        inCodeBlock,
        codeLanguage: inCodeBlock ? ((ed.getAttributes('codeBlock').language as string | undefined) ?? null) : null,
        inTable: ed.isActive('table'),
      }
    },
  }) ?? EMPTY_STATE
}
