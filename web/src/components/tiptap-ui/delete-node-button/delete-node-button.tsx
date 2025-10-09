'use client'

// --- UI Primitives ---
import type { ButtonProps } from '@/components/tiptap-ui-primitive/button'

// --- Tiptap UI ---
import type { UseDeleteNodeConfig } from '@/components/tiptap-ui/delete-node-button'

import * as React from 'react'

import { Badge } from '@/components/tiptap-ui-primitive/badge'
import { Button } from '@/components/tiptap-ui-primitive/button'

import { DELETE_NODE_SHORTCUT_KEY, useDeleteNode } from '@/components/tiptap-ui/delete-node-button'
// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'
// --- Lib ---
import { parseShortcutKeys } from '@/lib/tiptap-utils'

export interface DeleteNodeButtonProps extends Omit<ButtonProps, 'type'>, UseDeleteNodeConfig {
  /**
   * Optional text to display alongside the icon.
   */
  text?: string
  /**
   * Optional show shortcut keys in the button.
   * @default false
   */
  showShortcut?: boolean
}

export function DeleteNodeShortcutBadge({
  shortcutKeys = DELETE_NODE_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>
}

/**
 * Button component for deleting a node in a Tiptap editor.
 *
 * For custom button implementations, use the `useDeleteNode` hook instead.
 */
export const DeleteNodeButton = React.forwardRef<HTMLButtonElement, DeleteNodeButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onDeleted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const { isVisible, handleDeleteNode, label, shortcutKeys, Icon } = useDeleteNode({
      editor,
      hideWhenUnavailable,
      onDeleted,
    })

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented)
          return
        handleDeleteNode()
      },
      [handleDeleteNode, onClick],
    )

    if (!isVisible) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        role="button"
        tabIndex={-1}
        aria-label={label}
        tooltip="Delete"
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? (
          <>
            <Icon className="tiptap-button-icon" />
            {text && <span className="tiptap-button-text">{text}</span>}
            {showShortcut && <DeleteNodeShortcutBadge shortcutKeys={shortcutKeys} />}
          </>
        )}
      </Button>
    )
  },
)

DeleteNodeButton.displayName = 'DeleteNodeButton'
