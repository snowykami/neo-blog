import type { Schema } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import type { Root } from 'react-dom/client'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { Editor as EditorClass, EditorContent, getSchema } from '@tiptap/react'
import { NextIntlClientProvider } from 'next-intl'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { getLocaleMessages } from '@/locales'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'

let schema: Schema
let editor: Editor | null = null
let root: Root | null = null
let container: HTMLElement | null = null

// 等 React 渲染与微任务完成
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

afterEach(() => {
  root?.unmount()
  container?.remove()
  root = null
  container = null
  editor?.destroy()
  editor = null
})

function createEditor(content: string) {
  editor = new EditorClass({
    extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
    content,
  })
  return editor
}

/** 编辑器读入 HTML 后再序列化（与保存时的 getHTML 一致） */
function roundTrip(html: string): HTMLElement {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  const doc = PMDOMParser.fromSchema(schema).parse(body)
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return container
}

describe('视频节点', () => {
  it('无注释时就是 video 标签，始终带原生播放控件', () => {
    const video = roundTrip('<video src="/a.mp4"></video>').querySelector('video')!
    expect(video.getAttribute('src')).toBe('/a.mp4')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
  })

  it('有注释时保存为 figure + figcaption，对齐与宽度写在 figure 上', () => {
    const figure = roundTrip('<figure class="video-figure" data-align="left" data-width="75"><video src="/a.mp4"></video><figcaption>演示</figcaption></figure>').querySelector('figure')!
    expect(figure.getAttribute('data-align')).toBe('left')
    expect(figure.getAttribute('data-width')).toBe('75')
    expect(figure.querySelector('video')?.getAttribute('src')).toBe('/a.mp4')
    expect(figure.querySelector('figcaption')?.textContent).toBe('演示')
  })

  it('宽度只接受预设值，其他值丢弃', () => {
    const video = roundTrip('<video src="/a.mp4" data-width="61.8" data-align="right"></video>').querySelector('video')!
    expect([video.getAttribute('data-width'), video.getAttribute('data-align')]).toEqual(['61.8', 'right'])
    expect(roundTrip('<video src="/a.mp4" data-width="42"></video>').querySelector('video')!.hasAttribute('data-width')).toBe(false)
  })

  it('setVideo 命令按地址插入视频', () => {
    const target = createEditor('<p></p>')
    target.chain().focus().setVideo({ src: '/a.webm' }).run()
    expect(target.getHTML()).toContain('src="/a.webm"')
    expect(target.getHTML()).toContain('<video')
  })

  it('前台净化后保留 video、播放属性与注释结构', () => {
    const html = sanitizeContentHtml('<figure class="video-figure" data-width="75"><video src="/a.mp4" controls playsinline preload="metadata"></video><figcaption>演示</figcaption></figure>')
    expect(html).toContain('<video')
    expect(html).toContain('controls')
    expect(html).toContain('playsinline')
    expect(html).toContain('data-width="75"')
    expect(html).toContain('figcaption')
  })
})

describe('视频节点的视图', () => {
  it('编辑器里渲染原生播放器，注释写回节点属性', async () => {
    const target = createEditor('<p></p>')
    target.chain().focus().setVideo({ src: '/out/a.webm' }).run()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // 节点视图用 useTranslations 取文案，测试里手动提供一份完整文案
    root.render(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: getLocaleMessages('en'),
        children: createElement(EditorContent, { editor: target }),
      }),
    )
    await flush()

    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBe('/out/a.webm')
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')

    // 选中节点后出现注释输入框（与图片一致：悬停、选中或已有注释时显示）
    target.commands.setNodeSelection(0)
    await flush()
    await flush()
    const input = container.querySelector<HTMLInputElement>('[data-video-caption]')!
    expect(input).toBeTruthy()
    expect(input.placeholder.length).toBeGreaterThan(0)
  })
})
