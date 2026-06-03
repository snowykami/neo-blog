import type { Editor } from '@tiptap/react'
import { Columns2Icon, SquareChevronLeftIcon, SquareChevronRightIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
  const [activeAlign, setActiveAlign] = useState<Align | null>(null)

  const syncState = useCallback(() => {
    if (!editor) {
      setVisible(false)
      setActiveAlign(null)
      return
    }
    const nextVisible = isNodeTypeSelected(editor, ['image'])
    setVisible(nextVisible)
    setActiveAlign(nextVisible ? editor.getAttributes(EXTENSION_NAME)['data-align'] || Align.Left : null)
  }, [editor])

  useEffect(() => {
    syncState()
    if (!editor)
      return
    editor.on('selectionUpdate', syncState)
    editor.on('transaction', syncState)
    return () => {
      editor.off('selectionUpdate', syncState)
      editor.off('transaction', syncState)
    }
  }, [editor, syncState])

  const handleAlignChange = (align: Align) => {
    if (!editor)
      return null
    editor.chain().focus().updateAttributes(EXTENSION_NAME, { 'data-align': align }).run()
    setActiveAlign(align)
  }

  if (!editor || !visible)
    return null

  return (
    <div className="flex items-center gap-2 px-2">
      <button
        type="button"
        aria-label="Align image left"
        title="Align image left"
        className={`cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors ${activeAlign === Align.Left ? 'text-primary' : ''}`}
        onClick={() => handleAlignChange(Align.Left)}
      >
        <SquareChevronLeftIcon className="w-4 h-4 " />
      </button>
      <button
        type="button"
        aria-label="Align image center"
        title="Align image center"
        className={`cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors ${activeAlign === Align.Center ? 'text-primary' : ''}`}
        onClick={() => handleAlignChange(Align.Center)}
      >
        <Columns2Icon className="w-4 h-4" />
      </button>
      <button
        type="button"
        aria-label="Align image right"
        title="Align image right"
        className={`cursor-pointer hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors ${activeAlign === Align.Right ? 'text-primary' : ''}`}
        onClick={() => handleAlignChange(Align.Right)}
      >
        <SquareChevronRightIcon className="w-4 h-4" />
      </button>
    </div>
  )
}
