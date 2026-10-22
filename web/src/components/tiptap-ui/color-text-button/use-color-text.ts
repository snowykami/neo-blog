'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---

// --- Lib ---
import { isMarkInSchema, isNodeTypeSelected } from '@/lib/tiptap-utils'

export const COLOR_TEXT_SHORTCUT_KEY = 'mod+shift+t'

/**
 * Configuration for the color text functionality
 */
export interface UseColorTextConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The text color to apply.
   * Can be any valid CSS color value.
   */
  textColor: string
  /**
   * Optional text to display alongside the icon.
   */
  label: string
  /**
   * Whether the button should hide when the mark is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Called when the text color is applied.
   */
  onApplied?: ({ color, label }: { color: string, label: string }) => void
}

/**
 * Checks if text color can be toggled in the current editor state
 */
export function canColorText(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema('textStyle', editor) || isNodeTypeSelected(editor, ['image'])) {
    return false
  }

  try {
    return editor.can().setMark('textStyle', { color: 'currentColor' })
  }
  catch {
    return false
  }
}

/**
 * Checks if text color is active in the current selection
 */
export function isColorTextActive(editor: Editor | null, textColor: string): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.isActive('textStyle', { color: textColor })
}

/**
 * Determines if the color text button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable)
    return false
  if (!isMarkInSchema('textStyle', editor))
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canColorText(editor)
  }

  return true
}
