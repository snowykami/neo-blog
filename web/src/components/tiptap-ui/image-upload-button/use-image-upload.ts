'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---

// --- Lib ---
import { isExtensionAvailable, isNodeTypeSelected } from '@/lib/tiptap-utils'

export const IMAGE_UPLOAD_SHORTCUT_KEY = 'mod+shift+i'

/**
 * Configuration for the image upload functionality
 */
export interface UseImageUploadConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether the button should hide when insertion is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful image insertion.
   */
  onInserted?: () => void
}

/**
 * Checks if image can be inserted in the current editor state
 */
export function canInsertImage(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!isExtensionAvailable(editor, 'imageUpload') || isNodeTypeSelected(editor, ['image'])) {
    return false
  }

  return editor.can().insertContent({ type: 'imageUpload' })
}

/**
 * Checks if image is currently active
 */
export function isImageActive(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.isActive('imageUpload')
}

/**
 * Inserts an image in the editor
 */
export function insertImage(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  if (!canInsertImage(editor))
    return false

  try {
    return editor
      .chain()
      .focus()
      .insertContent({
        type: 'imageUpload',
      })
      .run()
  }
  catch {
    return false
  }
}

/**
 * Determines if the image button should be shown
 */
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable)
    return false
  if (!isExtensionAvailable(editor, 'imageUpload'))
    return false

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canInsertImage(editor)
  }

  return true
}
