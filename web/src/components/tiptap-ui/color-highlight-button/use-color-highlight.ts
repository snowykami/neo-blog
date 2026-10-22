'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---

// --- Lib ---
import { isMarkInSchema, isNodeTypeSelected } from '@/lib/tiptap-utils'

export const COLOR_HIGHLIGHT_SHORTCUT_KEY = 'mod+shift+h'

/**
 * Configuration for the color highlight functionality
 */
export interface UseColorHighlightConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The color to apply when toggling the highlight.
   */
  highlightColor?: string
  /**
   * Optional label to display alongside the icon.
   */
  label?: string
  /**
   * Whether the button should hide when the mark is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Called when the highlight is applied.
   */
  onApplied?: ({ color, label }: { color: string, label: string }) => void
}

export function canColorHighlight(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema('highlight', editor) || isNodeTypeSelected(editor, ['image'])) {
    return false
  }

  return editor.can().setMark('highlight')
}

export function isColorHighlightActive(editor: Editor | null, highlightColor?: string): boolean {
  if (!editor || !editor.isEditable)
    return false
  return highlightColor
    ? editor.isActive('highlight', { color: highlightColor })
    : editor.isActive('highlight')
}

export function removeHighlight(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!canColorHighlight(editor))
    return false

  return editor.chain().focus().unsetMark('highlight').run()
}

export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema('highlight', editor))
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canColorHighlight(editor)
  }

  return true
}
