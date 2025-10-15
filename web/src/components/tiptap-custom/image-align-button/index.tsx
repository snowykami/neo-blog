import type { Editor } from '@tiptap/react'
import { Columns2Icon, SquareChevronLeftIcon, SquareChevronRightIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isNodeTypeSelected } from '@/lib/tiptap-utils'

const EXTENSION_NAME = 'image'

enum Align {
  Left = 'left',
  Center = 'center',
  Right = 'right',
}

export function ImageAlignButton(
  { editor }: { editor: Editor | null },
) {
  const [visible, setVisible] = useState(isNodeTypeSelected(editor, ['image']))
  useEffect(() => {
    if (!editor)
      return
    const handleSelectionUpdate = () => {
      setVisible(isNodeTypeSelected(editor, ['image']))
    }
    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])
  const handleAlignChange = (align: Align) => {
    if (!editor)
      return null
    editor.chain().focus().updateAttributes(EXTENSION_NAME, { 'data-align': align }).run()
  }

  if (!editor || !visible)
    return null

  return (
    <div className="flex items-center gap-2 px-2">
      <button
        className="cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors"
        onClick={() => handleAlignChange(Align.Left)}
      >
        <SquareChevronLeftIcon className="w-4 h-4 " />
      </button>
      <button
        className="cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors"
        onClick={() => handleAlignChange(Align.Center)}
      >
        <Columns2Icon className="w-4 h-4" />
      </button>
      <button
        className="cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors"
        onClick={() => handleAlignChange(Align.Right)}
      >
        <SquareChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
  )
}
