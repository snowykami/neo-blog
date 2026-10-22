'use client'

import type { Editor } from '@tiptap/react'

// --- Icons ---

// --- Hooks ---

// --- Lib ---
import { isMarkInSchema } from '@/lib/tiptap-utils'

/**
 * Configuration for the link popover functionality
 */
export interface UseLinkPopoverConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether to hide the link popover when not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called when the link is set.
   */
  onSetLink?: () => void
}

/**
 * Configuration for the link handler functionality
 */
export interface LinkHandlerProps {
  /**
   * The Tiptap editor instance.
   */
  editor: Editor | null
  /**
   * Callback function called when the link is set.
   */
  onSetLink?: () => void
}

/**
 * Checks if a link can be set in the current editor state
 */
export function canSetLink(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.can().setMark('link')
}

/**
 * Checks if a link is currently active in the editor
 */
export function isLinkActive(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable)
    return false
  return editor.isActive('link')
}

/**
 * Determines if the link button should be shown
 */
export function shouldShowLinkButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  const linkInSchema = isMarkInSchema('link', editor)

  if (!linkInSchema || !editor) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive('code')) {
    return canSetLink(editor)
  }

  return true
}
