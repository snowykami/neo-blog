'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---
// --- Lib ---
import { isNodeTypeSelected } from '@/lib/tiptap-utils'

export type UndoRedoAction = 'undo' | 'redo'

/**
 * Configuration for the history functionality
 */
export interface UseUndoRedoConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The history action to perform (undo or redo).
   */
  action: UndoRedoAction
  /**
   * Whether the button should hide when action is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful action execution.
   */
  onExecuted?: () => void
}

export const UNDO_REDO_SHORTCUT_KEYS: Record<UndoRedoAction, string> = {
  undo: 'mod+z',
  redo: 'mod+shift+z',
}

export const historyActionLabels: Record<UndoRedoAction, string> = {
  undo: 'Undo',
  redo: 'Redo',
}

/**
 * Checks if a history action can be executed
 */
export function canExecuteUndoRedoAction(editor: Editor | null, action: UndoRedoAction): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (isNodeTypeSelected(editor, ['image']))
    return false

  return action === 'undo' ? editor.can().undo() : editor.can().redo()
}

/**
 * Executes a history action on the editor
 */
export function executeUndoRedoAction(editor: Editor | null, action: UndoRedoAction): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!canExecuteUndoRedoAction(editor, action))
    return false

  const chain = editor.chain().focus()
  return action === 'undo' ? chain.undo().run() : chain.redo().run()
}

/**
 * Determines if the history button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
  action: UndoRedoAction
}): boolean {
  const { editor, hideWhenUnavailable, action } = props

  if (!editor || !editor.isEditable)
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canExecuteUndoRedoAction(editor, action)
  }

  return true
}
