import type { Schema } from '@tiptap/pm/model'
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { sanitizeContentHtml } from '@/utils/server/sanitize-html'
import { mediaWidthAttrs, parseMediaWidthPreset } from './media-width'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

/** 编辑器读入 HTML 后再序列化（与保存时的 getHTML 一致） */
function roundTrip(html: string): HTMLElement {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  const doc = PMDOMParser.fromSchema(schema).parse(body)
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content))
  return container
}

describe('媒体宽度预设', () => {
  it('只接受五个预设值', () => {
    expect(['33', '50', '61.8', '75', '100'].map(parseMediaWidthPreset)).toEqual(['33', '50', '61.8', '75', '100'])
    expect([null, '', '42', '61', 61.8, '100%'].map(parseMediaWidthPreset)).toEqual([null, null, null, null, '61.8', null])
  })

  it('选择预设时写入 data-width，恢复原始尺寸时清空', () => {
    expect(mediaWidthAttrs('61.8')).toEqual({ 'data-width': '61.8' })
    expect(mediaWidthAttrs(null)).toEqual({ 'data-width': null })
  })

  it('图片：无注释时写在 img 上，有注释时同时写在 figure 上；非预设值丢弃', () => {
    const plain = roundTrip('<img src="/a.png" data-width="61.8" data-align="left">').querySelector('img')!
    expect([plain.getAttribute('data-width'), plain.getAttribute('data-align')]).toEqual(['61.8', 'left'])

    const figure = roundTrip('<figure class="image-figure" data-width="33"><img src="/a.png"><figcaption>说明</figcaption></figure>').querySelector('figure')!
    expect(figure.getAttribute('data-width')).toBe('33')
    expect(figure.querySelector('figcaption')?.textContent).toBe('说明')

    expect(roundTrip('<img src="/a.png" data-width="42">').querySelector('img')!.hasAttribute('data-width')).toBe(false)
  })

  it('前台净化后保留 data-width', () => {
    expect(sanitizeContentHtml('<img src="/a.png" data-width="75">')).toContain('data-width="75"')
  })
})
