'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---
// --- Lib ---
import { isMarkInSchema, isNodeTypeSelected } from '@/lib/tiptap-utils'

export type Mark
  = | 'bold'
    | 'italic'
    | 'strike'
    | 'code'
    | 'underline'
    | 'superscript'
    | 'subscript'

/**
 * Configuration for the mark functionality
 */
export interface UseMarkConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The type of mark to toggle
   */
  type: Mark
  /**
   * Whether the button should hide when mark is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful mark toggle.
   */
  onToggled?: () => void
}

export const MARK_SHORTCUT_KEYS: Record<Mark, string> = {
  bold: 'mod+b',
  italic: 'mod+i',
  underline: 'mod+u',
  strike: 'mod+shift+s',
  code: 'mod+e',
  superscript: 'mod+.',
  subscript: 'mod+,',
}

/**
 * Checks if a mark can be toggled in the current editor state
 */
export function canToggleMark(editor: Editor | null, type: Mark): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema(type, editor) || isNodeTypeSelected(editor, ['image']))
    return false

  return editor.can().toggleMark(type)
}

/**
 * Checks if a mark is currently active
 */
export function isMarkActive(editor: Editor | null, type: Mark): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.isActive(type)
}

/**
 * Toggles a mark in the editor
 */
export function toggleMark(editor: Editor | null, type: Mark): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!canToggleMark(editor, type))
    return false

  return editor.chain().focus().toggleMark(type).run()
}

/**
 * Determines if the mark button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  type: Mark
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, type, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema(type, editor))
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canToggleMark(editor, type)
  }

  return true
}

/**
 * Gets the formatted mark name
 */
export function getFormattedMarkName(type: Mark): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}
