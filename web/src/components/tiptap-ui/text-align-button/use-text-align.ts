'use client'

import type { ChainedCommands, Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---
// --- Lib ---
import { isExtensionAvailable, isNodeTypeSelected } from '@/lib/tiptap-utils'

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/**
 * Configuration for the text align functionality
 */
export interface UseTextAlignConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * The text alignment to apply.
   */
  align: TextAlign
  /**
   * Whether the button should hide when alignment is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful alignment change.
   */
  onAligned?: () => void
}

export const TEXT_ALIGN_SHORTCUT_KEYS: Record<TextAlign, string> = {
  left: 'mod+shift+l',
  center: 'mod+shift+e',
  right: 'mod+shift+r',
  justify: 'mod+shift+j',
}

export const textAlignLabels: Record<TextAlign, string> = {
  left: 'Align left',
  center: 'Align center',
  right: 'Align right',
  justify: 'Align justify',
}

/**
 * Checks if text alignment can be performed in the current editor state
 */
export function canSetTextAlign(editor: Editor | null, align: TextAlign): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (
    !isExtensionAvailable(editor, 'textAlign')
    || isNodeTypeSelected(editor, ['image', 'horizontalRule'])
  ) {
    return false
  }

  return editor.can().setTextAlign(align)
}

export function hasSetTextAlign(commands: ChainedCommands): commands is ChainedCommands & {
  setTextAlign: (align: TextAlign) => ChainedCommands
} {
  return 'setTextAlign' in commands
}

/**
 * Checks if the text alignment is currently active
 */
export function isTextAlignActive(editor: Editor | null, align: TextAlign): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.isActive({ textAlign: align })
}

/**
 * Sets text alignment in the editor
 */
export function setTextAlign(editor: Editor | null, align: TextAlign): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!canSetTextAlign(editor, align))
    return false

  const chain = editor.chain().focus()
  if (hasSetTextAlign(chain)) {
    return chain.setTextAlign(align).run()
  }

  return false
}

/**
 * Determines if the text align button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
  align: TextAlign
}): boolean {
  const { editor, hideWhenUnavailable, align } = props

  if (!editor || !editor.isEditable)
    return false
  if (!isExtensionAvailable(editor, 'textAlign'))
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canSetTextAlign(editor, align)
  }

  return true
}
