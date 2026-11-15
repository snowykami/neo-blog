import type { Editor } from '@tiptap/react'
import type { Root } from 'react-dom/client'
import { Editor as EditorClass } from '@tiptap/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_PREVIEW_META } from '@/components/tiptap-extension/ai-write-extension'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { countDocWords, useEditorStats } from './use-editor-stats'

;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let editor: Editor | null = null
let root: Root | null = null
let container: HTMLElement | null = null

function createEditor(content: string) {
  editor = new EditorClass({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
    content,
  })
  return editor
}

function mountStats(ed: Editor, onUpdate: (stats: { words: number, readingMinutes: number }) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  function Harness() {
    const stats = useEditorStats(ed)
    onUpdate(stats)
    return createElement('span', null, `${stats.words}:${stats.readingMinutes}`)
  }
  act(() => {
    root!.render(createElement(Harness))
  })
}

afterEach(() => {
  vi.useRealTimers()
  act(() => {
    root?.unmount()
  })
  container?.remove()
  editor?.destroy()
  root = null
  container = null
  editor = null
})

describe('countDocWords', () => {
  it('与 doc.textContent 去除空白后的字符数完全一致', () => {
    const cases = [
      '<p></p>',
      '<p>Hello world!</p>',
      '<p>中文 测试\t换行</p><p>第二段 123</p>',
      '<p>Line1<br>Line2</p>',
      '<p>Mix <span data-icon="star"></span> 文字</p>',
    ]
    for (const html of cases) {
      const ed = createEditor(html)
      const expected = ed.state.doc.textContent.replace(/\s/g, '').length
      expect(countDocWords(ed.state.doc)).toBe(expected)
      ed.destroy()
      editor = null
    }
  })
})

describe('useEditorStats', () => {
  it('忽略仅选区变化，打字 120ms 防抖，文档重置立即刷新', () => {
    vi.useFakeTimers()
    const ed = createEditor('<p>你好世界</p>')
    const spy = vi.fn()
    mountStats(ed, spy)

    expect(container?.textContent).toBe('4:1')
    const initialCalls = spy.mock.calls.length

    // 仅选区变动不触发统计更新
    act(() => {
      ed.commands.setTextSelection(2)
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(spy.mock.calls.length).toBe(initialCalls)

    // 连续打字期间在 120ms 到期前不触发更新
    act(() => {
      ed.commands.insertContent('ABC')
    })
    act(() => {
      vi.advanceTimersByTime(80)
    })
    expect(container?.textContent).toBe('4:1')

    act(() => {
      ed.commands.insertContent('DEF')
    })
    act(() => {
      vi.advanceTimersByTime(80)
    })
    expect(container?.textContent).toBe('4:1')

    // 停顿满 120ms 后一次性刷新
    act(() => {
      vi.advanceTimersByTime(40)
    })
    expect(container?.textContent).toBe('10:1')

    // 载入/重置文档（addToHistory=false 且非 AI 预览）应立即刷新
    act(() => {
      ed.chain().setMeta('addToHistory', false).setContent('<p>全新内容十二个字符这里</p>', { emitUpdate: false }).run()
    })
    expect(container?.textContent).toBe('11:1')

    // AI 预览事务不走立即重置通道，仍受防抖控制
    act(() => {
      ed.view.dispatch(
        ed.state.tr.insertText('预览', 1).setMeta('addToHistory', false).setMeta(AI_PREVIEW_META, true),
      )
    })
    expect(container?.textContent).toBe('11:1')
    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(container?.textContent).toBe('13:1')
  })
})
