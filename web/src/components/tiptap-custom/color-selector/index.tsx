import type { Attrs } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { canColorHighlight } from '@/components/tiptap-ui/color-highlight-button'
import { canColorText } from '@/components/tiptap-ui/color-text-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useStoredState } from '@/hooks/use-storage-state'
import { getActiveMarkAttrs } from '@/lib/tiptap-advanced-utils'

const HISTORY_LIMIT = 8

function labelToTextColor(color: string): string {
  return `var(--color-${color}-500)`
}

function labelToHighlightColor(color: string): string {
  return `var(--color-${color}-200)`
}

interface Color {
  label: string
  type: 'text' | 'background'
  color: string | null
}

const colorNames: (string | null)[] = [
  null,
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]

const ColorPresets: Color[] = colorNames.flatMap((name): Color[] =>
  name === null
    ? [
        { label: 'Default', type: 'text', color: null },
        { label: 'Default', type: 'background', color: null },
      ]
    : [
        { label: name, type: 'text', color: labelToTextColor(name) },
        { label: name, type: 'background', color: labelToHighlightColor(name) },
      ],
)

export function ColorSelector({ editor }: { editor: Editor }) {
  const [currentColor, setCurrentColor] = useState<Attrs | null>(null)
  const [currentHighlight, setCurrentHighlight] = useState<Attrs | null>(null)
  const [canSetColor, setCanSetColor] = useState(() => canColorText(editor) || canColorHighlight(editor))
  const [keepOpen, setKeepOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useStoredState<Color[]>('editor-color-selector-history', [])

  useEffect(() => {
    if (!editor)
      return

    const updateActiveMarks = () => {
      setCanSetColor(canColorText(editor) || canColorHighlight(editor))
      if (!canSetColor) {
        return
      }
      setCurrentColor(getActiveMarkAttrs(editor, 'textStyle'))
      setCurrentHighlight(getActiveMarkAttrs(editor, 'highlight'))
    }

    // 初始同步
    updateActiveMarks()

    // 监听选区变化与文档更新
    editor.on('selectionUpdate', updateActiveMarks)
    editor.on('update', updateActiveMarks)

    // 清理
    return () => {
      editor.off('selectionUpdate', updateActiveMarks)
      editor.off('update', updateActiveMarks)
    }
  }, [])

  const onColorUpdate = (color: Color) => {
    // 记录历史，排除第一个重复，若里面已经有了，不是第一个就提到最前面
    if (color.color !== null) {
      const filtered = history.filter(c => c.label !== color.label || c.type !== color.type)
      const newHistory = [color, ...filtered]
      if (newHistory.length > HISTORY_LIMIT)
        newHistory.length = HISTORY_LIMIT
      setHistory(newHistory)
    }

    if (keepOpen) {
      // 不 focus 编辑器，避免 popover 因失去焦点而关闭
      if (color.type === 'text') {
        if (color.color)
          editor.chain().setColor(color.color).run()
        else editor.chain().unsetColor().run()
      }
      else {
        if (color.color)
          editor.chain().setHighlight({ color: color.color }).run()
        else editor.chain().unsetHighlight().run()
      }
      // 保持打开并同步 UI 状态
      setOpen(true)
      setCurrentColor(getActiveMarkAttrs(editor, 'textStyle'))
      setCurrentHighlight(getActiveMarkAttrs(editor, 'highlight'))
    }
    else {
      // 原先行为：focus 编辑器（常用于立即生效与键盘交互），并在应用后关闭 popover
      if (color.type === 'text') {
        if (!(canColorText(editor)))
          return
        if (color.color)
          editor.chain().focus().setColor(color.color).run()
        else editor.chain().focus().unsetColor().run()
      }
      else {
        if (!(canColorHighlight(editor)))
          return
        if (color.color)
          editor.chain().focus().setHighlight({ color: color.color }).run()
        else editor.chain().focus().unsetHighlight().run()
      }
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center text-sm"
          disabled={!canSetColor}
          aria-disabled={!canSetColor}
        >
          <span
            className="w-5 h-5 inline-flex items-center justify-center rounded-full border-1 p-1"
            style={
              canSetColor
                ? { color: currentColor?.color || undefined, backgroundColor: currentHighlight?.color || undefined }
                : { color: 'var(--color-slate-400)', backgroundColor: 'var(--color-slate-100)' }
            }
          >
            A
          </span>
          <ChevronDownIcon className="w-3 h-3 ml-1" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="rounded-2xl max-w-[210px] lg:max-w-[360px]">
        <div className="font-bold flex items-center justify-between mb-2">
          <div>Color</div>
          <div className="flex items-center gap-2 justify-end">
            <Label className="px-2 pt-1 text-sm">Keep open</Label>
            <Checkbox checked={keepOpen} onCheckedChange={checked => setKeepOpen(checked === true)} />
          </div>
        </div>
        {/* 历史 */}
        {history.length > 0 && (
          <div>
            <div className="font-medium text-sm">History</div>
            <div className="grid grid-cols-5 lg:grid-cols-8 gap-2 py-2">
              {history.map((color, index) => (
                <div
                  key={color.label + color.type + index}
                  className="w-6 h-6 rounded-full flex justify-center items-center cursor-pointer border-1 hover:ring-2 hover:ring-offset-1 hover:ring-primary"
                  style={color.type === 'text'
                    ? { color: labelToTextColor(color.label), borderColor: labelToTextColor(color.label) || 'blue' }
                    : { backgroundColor: labelToHighlightColor(color.label) || '', borderColor: '#00000022' }}
                  title={`${color.label} ${color.type === 'text' ? 'text' : 'background'}`}
                  onClick={() => {
                    onColorUpdate(color)
                  }}
                >
                  {color.type === 'text' && 'A'}
                </div>
              ))}
            </div>
            <hr className="my-2" />
          </div>
        )}
        {/* 颜色选择 */}
        <ColorSelectorPopover onColorSelect={onColorUpdate} />
      </PopoverContent>
    </Popover>
  )
}

function ColorSelectorPopover({
  onColorSelect,
}: {
  onColorSelect: (color: Color) => void
}) {
  return (
    <div>
      {/* 文本色 */}
      <div className="font-medium text-sm">Text</div>
      <div className="grid grid-cols-5 lg:grid-cols-8 gap-2 py-2">
        {ColorPresets.filter(c => c.type === 'text').map(color => (
          <div
            key={color.label + color.type}
            className="relative w-6 h-6 rounded-full flex justify-center items-center cursor-pointer border-1 hover:ring-2 hover:ring-offset-1 hover:ring-primary"
            style={
              color.color
                ? { color: labelToTextColor(color.label), borderColor: labelToTextColor(color.label) || 'blue' }
                : { color: 'var(--color-slate-400)', borderColor: 'var(--color-slate-300)' }
            }
            title={`${color.label} text`}
            onClick={() => {
              onColorSelect(color)
            }}
          >
            A
            {color.color === null && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-[2px] h-3 bg-current rotate-45" />
              </span>
            )}
          </div>
        ))}
      </div>
      {/* 背景色 */}
      <div className="font-medium text-sm">Highlight</div>
      <div className="grid grid-cols-5 lg:grid-cols-8 gap-2 py-2">
        {ColorPresets.filter(c => c.type === 'background').map(color => (
          <div
            key={color.label + color.type}
            className="relative w-6 h-6 rounded-full cursor-pointer border-1 hover:ring-2 hover:ring-offset-1 hover:ring-primary"
            style={
              color.color
                ? { backgroundColor: labelToHighlightColor(color.label) || '', borderColor: '#00000022' }
                : { backgroundColor: 'transparent', borderColor: '#00000022', color: 'var(--color-slate-600)' }
            }
            title={`${color.label} background`}
            onClick={() => {
              onColorSelect(color)
            }}
          >
            {color.color === null && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-[2px] h-3 bg-current rotate-45" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
