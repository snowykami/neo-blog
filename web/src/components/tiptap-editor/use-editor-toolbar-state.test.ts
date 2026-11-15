import type { Editor } from '@tiptap/react'
import type { Root } from 'react-dom/client'
import { Editor as EditorClass } from '@tiptap/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { EditorToolbarStateProvider, useEditorToolbarState } from './use-editor-toolbar-state'

;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let editor: Editor | null = null
let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  editor?.destroy()
  root = null
  container = null
  editor = null
})

function Consumer({ ed }: { ed: Editor }) {
  const state = useEditorToolbarState(ed)
  return createElement('span', null, state.blockType)
}

describe('editorToolbarStateProvider', () => {
  it('多个订阅者共享一次 transaction 监听，独立使用时回退为各自订阅', () => {
    editor = new EditorClass({
      extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
      content: '<p>hello</p>',
    })

    const onSpy = vi.spyOn(editor, 'on')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        createElement(
          EditorToolbarStateProvider,
          { editor, children: [1, 2, 3, 4].map(key => createElement(Consumer, { key, ed: editor! })) },
        ),
      )
    })

    const txRegistrationsInProvider = onSpy.mock.calls.filter(([event]) => event === 'transaction').length
    expect(txRegistrationsInProvider).toBe(1)

    onSpy.mockClear()
    act(() => {
      root!.render(
        createElement('div', null, [1, 2].map(key => createElement(Consumer, { key, ed: editor! }))),
      )
    })

    const txRegistrationsStandalone = onSpy.mock.calls.filter(([event]) => event === 'transaction').length
    expect(txRegistrationsStandalone).toBe(2)
  })
})
