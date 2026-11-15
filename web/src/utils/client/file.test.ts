import type { FileModel } from '@/models/file'
import { describe, expect, it } from 'vitest'
import { extensionFromMime, getFileIcon, getFileUri, mimeCategoryFromFile, mimeTypeIcons } from './file'

function makeFile(overrides: Partial<FileModel> = {}): FileModel {
  return {
    id: 42,
    name: 'demo.png',
    hash: 'abc',
    group: '',
    type: 'file',
    userId: 1,
    providerId: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    size: 1024,
    mimeType: 'image/png',
    ...overrides,
  }
}

describe('文件图标与类型识别', () => {
  it('解析预签名 URL 时忽略查询参数和 hash 锚点', () => {
    expect(mimeCategoryFromFile({
      name: 'https://bucket.s3.amazonaws.com/uploads/photo.WEBP?X-Amz-Signature=deadbeef&X-Amz-Expires=300#preview',
      type: 'application/octet-stream',
    })).toBe('image')

    expect(mimeCategoryFromFile({
      name: 'https://cdn.example.com/v1.0/track.mp3?token=abc#t=10',
      type: '',
    })).toBe('audio')

    expect(mimeCategoryFromFile({
      name: 'https://cdn.example.com/folder.with.dots/archive?X-Amz-Signature=123',
      type: '',
    })).toBe('file')
  })

  it('位图在 showImage=true 时返回预览地址，showImage=false 时返回图片图标', () => {
    const pngFile = makeFile({ id: 7, name: 'https://s3.example.com/a.jpg?X-Amz-Signature=sig#h', mimeType: 'application/octet-stream' })
    expect(getFileIcon({ file: pngFile, showImage: true })).toBe(getFileUri(7))
    expect(getFileIcon({ file: pngFile, showImage: false })).toBe(mimeTypeIcons.image)

    const avifFile = makeFile({ id: 8, name: 'cover.avif', mimeType: 'image/avif; charset=utf-8' })
    expect(getFileIcon({ file: avifFile, showImage: true })).toBe(getFileUri(8))
  })

  it('svg 文件不返回无扩展名的 /api/v1/file/f/:id 走图片优化，而是回退图片图标', () => {
    const svgByMime = makeFile({ id: 9, name: 'logo.svg', mimeType: 'image/svg+xml' })
    expect(getFileIcon({ file: svgByMime, showImage: true })).toBe(mimeTypeIcons.image)

    const svgByUrl = makeFile({
      id: 10,
      name: 'https://bucket.s3.amazonaws.com/icon.svg?X-Amz-Signature=xyz#hash',
      mimeType: '',
    })
    expect(getFileIcon({ file: svgByUrl, showImage: true })).toBe(mimeTypeIcons.image)
  })

  it('按音视频与其它类型返回对应图标并规范化 MIME 扩展名', () => {
    expect(getFileIcon({ file: makeFile({ name: 'clip.mp4', mimeType: 'video/mp4' }) })).toBe(mimeTypeIcons.video)
    expect(getFileIcon({ file: makeFile({ name: 'bgm.flac', mimeType: 'audio/flac' }) })).toBe(mimeTypeIcons.audio)
    expect(getFileIcon({ file: makeFile({ name: 'readme.md', mimeType: 'text/markdown' }) })).toBe(mimeTypeIcons.file)
    expect(extensionFromMime('IMAGE/SVG+XML; charset=utf-8')).toBe('svg')
  })
})
