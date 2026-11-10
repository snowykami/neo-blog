import { describe, expect, it } from 'vitest'
import { attachmentMarkerMessage, parseAttachmentMarker } from './attachment-marker'

describe('attachment marker', () => {
  it('parses markers written by the backend', () => {
    expect(parseAttachmentMarker('[[neo:attachment:image:3]]')).toEqual({ kind: 'image', count: 3 })
    expect(parseAttachmentMarker(' [[neo:attachment:file:1]] ')).toEqual({ kind: 'file', count: 1 })
  })

  it('leaves normal text alone', () => {
    expect(parseAttachmentMarker('hello [[neo:attachment:image:3]]')).toBeNull()
    expect(parseAttachmentMarker('[附件]')).toBeNull()
  })

  it('picks singular or plural message keys', () => {
    expect(attachmentMarkerMessage({ kind: 'image', count: 1 })).toEqual({ key: 'attachment_image', count: 1 })
    expect(attachmentMarkerMessage({ kind: 'image', count: 2 })).toEqual({ key: 'attachment_images', count: 2 })
    expect(attachmentMarkerMessage({ kind: 'file', count: 4 })).toEqual({ key: 'attachment_files', count: 4 })
  })
})
