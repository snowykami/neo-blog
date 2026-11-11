import type { Schema } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { markUploadingPlaceholder, stripUploadingPlaceholders } from './upload-queue'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, schema.text(text))
}

describe('保存时剔除正在上传的占位块', () => {
  it('只剔除正在上传的占位块，空的占位块与其他内容保留', () => {
    const uploading = schema.nodes.imageUpload.create()
    const idle = schema.nodes.videoUpload.create()
    const doc = schema.nodes.doc.create(null, [paragraph('a'), uploading, paragraph('b'), idle])
    markUploadingPlaceholder(uploading, true)
    const stripped = stripUploadingPlaceholders(doc)
    expect(stripped?.childCount).toBe(3)
    expect(stripped?.child(0).textContent).toBe('a')
    expect(stripped?.child(1).textContent).toBe('b')
    expect(stripped?.child(2).type.name).toBe('videoUpload')
  })

  it('上传结束后不再剔除；没有要剔除的占位块时返回 null', () => {
    const node = schema.nodes.imageUpload.create()
    const doc = schema.nodes.doc.create(null, [paragraph('a'), node])
    markUploadingPlaceholder(node, true)
    expect(stripUploadingPlaceholders(doc)).not.toBeNull()
    markUploadingPlaceholder(node, false)
    expect(stripUploadingPlaceholders(doc)).toBeNull()
  })

  it('多个占位块正在上传时全部剔除', () => {
    const first = schema.nodes.imageUpload.create()
    const second = schema.nodes.imageUpload.create()
    const doc = schema.nodes.doc.create(null, [first, paragraph('a'), second, paragraph('b')])
    markUploadingPlaceholder(first, true)
    markUploadingPlaceholder(second, true)
    const stripped = stripUploadingPlaceholders(doc)
    expect(stripped?.childCount).toBe(2)
    expect(stripped?.textContent).toBe('ab')
  })
})
