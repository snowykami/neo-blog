import type { Editor } from '@tiptap/react'

// --- UI Primitive ---
import { Separator } from '@/components/tiptap-ui-primitive/separator'

// --- Tiptap UI ---
import { DeleteNodeButton } from '@/components/tiptap-ui/delete-node-button'

import { ImageAlignButton } from '@/components/tiptap-ui/image-align-button'
import { ImageDownloadButton } from '@/components/tiptap-ui/image-download-button'
// --- Hooks ---
import { useTiptapEditor } from '@/hooks/use-tiptap-editor'

// --- Lib ---
import { isNodeTypeSelected } from '@/lib/tiptap-utils'

export function ImageNodeFloating({
  editor: providedEditor,
}: {
  editor?: Editor | null
}) {
  const { editor } = useTiptapEditor(providedEditor)
  const visible = isNodeTypeSelected(editor, ['image'])

  if (!editor || !visible) {
    return null
  }

  return (
    <>
      <ImageAlignButton align="left" />
      <ImageAlignButton align="center" />
      <ImageAlignButton align="right" />
      <Separator />
      <ImageDownloadButton />
      <Separator />
      <DeleteNodeButton />
    </>
  )
}
