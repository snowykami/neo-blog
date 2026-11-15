import type { Schema } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { Root } from 'react-dom/client'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { Editor as EditorClass, getSchema } from '@tiptap/react'
import { NextIntlClientProvider } from 'next-intl'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { getLocaleMessages } from '@/locales'
import { IMAGE_FIGURE_CLASS } from './image-node-constants'
import { ResizableImage } from './image-node-view'

;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let schema: Schema
let editor: Editor | null = null
let root: Root | null = null
let container: HTMLElement | null = null

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => {
    root?.unmount()
  })
  container?.remove()
  editor?.destroy()
  root = null
  container = null
  editor = null
})

function roundTrip(html: string): HTMLElement {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  const doc = PMDOMParser.fromSchema(schema).parse(body)
  const wrapper = document.createElement('div')
  wrapper.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return wrapper
}

describe('图片节点', () => {
  it('renderHTML 为无注释与带注释图片均输出懒加载属性', () => {
    const plainImg = roundTrip('<img src="/a.png" alt="demo">').querySelector('img')!
    expect(plainImg.getAttribute('loading')).toBe('lazy')
    expect(plainImg.getAttribute('decoding')).toBe('async')

    const figure = roundTrip(`<figure class="${IMAGE_FIGURE_CLASS}"><img src="/b.png"><figcaption>说明</figcaption></figure>`)
    const figureImg = figure.querySelector('img')!
    expect(figureImg.getAttribute('loading')).toBe('lazy')
    expect(figureImg.getAttribute('decoding')).toBe('async')
    expect(figure.querySelector('figcaption')?.textContent).toBe('说明')
  })

  it('节点视图图片带懒加载属性，空闲时不注册 window 指针监听器并在拖拽结束后注销', () => {
    const ed = new EditorClass({
      extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
      content: '<p></p>',
    })
    editor = ed

    const addWindowListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeWindowListenerSpy = vi.spyOn(window, 'removeEventListener')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        createElement(NextIntlClientProvider, {
          locale: 'en',
          messages: getLocaleMessages('en'),
          children: createElement(ResizableImage, { src: '/photo.webp', alt: 'photo', editor: ed }),
        }),
      )
    })

    const img = container.querySelector('img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')

    const pointerEventCount = (calls: unknown[][]) =>
      calls.filter(([event]) => String(event) === 'pointermove' || String(event) === 'pointerup').length

    expect(pointerEventCount(addWindowListenerSpy.mock.calls)).toBe(0)

    // 点击图片显示调整手柄并开始拖拽右手柄
    const wrapper = container.querySelector('.tiptap-image')!
    act(() => {
      wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const rightHandle = container.querySelector('.tiptap-image-handle-right')
    expect(rightHandle).toBeTruthy()

    act(() => {
      rightHandle!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100 }))
    })
    expect(pointerEventCount(addWindowListenerSpy.mock.calls)).toBe(2)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
    expect(pointerEventCount(removeWindowListenerSpy.mock.calls)).toBe(2)
  })
})
