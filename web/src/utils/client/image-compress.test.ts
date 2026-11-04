import { describe, expect, it } from 'vitest'
import {
  COMPRESS_PRESETS,
  compressImage,
  compressQuality,
  DEFAULT_COMPRESS_LEVEL,
  isCompressibleImage,
  peekCompressedImage,
  snapToCompressPreset,
} from './image-compress'

describe('image-compress', () => {
  it('档位沿用原有等级与质量的对应关系', () => {
    expect(COMPRESS_PRESETS.map(preset => [preset.key, preset.level])).toEqual([
      ['original', 0],
      ['high', 2],
      ['balanced', 5],
      ['small', 7],
    ])
    expect(compressQuality(2)).toBeCloseTo(0.8)
    expect(compressQuality(5)).toBeCloseTo(0.5)
    expect(compressQuality(7)).toBeCloseTo(0.3)
    expect(compressQuality(10)).toBeCloseTo(0.1)
    expect(DEFAULT_COMPRESS_LEVEL).toBe(5)
  })

  it('把任意等级归到最接近的档位，非法值回退到默认档', () => {
    expect(snapToCompressPreset(0)).toBe(0)
    expect(snapToCompressPreset(3)).toBe(2)
    expect(snapToCompressPreset(5)).toBe(5)
    expect(snapToCompressPreset(10)).toBe(7)
    expect(snapToCompressPreset(null)).toBe(DEFAULT_COMPRESS_LEVEL)
    expect(snapToCompressPreset('5')).toBe(DEFAULT_COMPRESS_LEVEL)
    expect(snapToCompressPreset(Number.NaN)).toBe(DEFAULT_COMPRESS_LEVEL)
  })

  it('只压缩 canvas 能重新编码的位图格式', () => {
    expect(isCompressibleImage(new Blob([], { type: 'image/jpeg' }))).toBe(true)
    expect(isCompressibleImage(new Blob([], { type: 'image/png' }))).toBe(true)
    expect(isCompressibleImage(new Blob([], { type: 'image/webp' }))).toBe(true)
    expect(isCompressibleImage(new Blob([], { type: 'image/gif' }))).toBe(false)
    expect(isCompressibleImage(new Blob([], { type: 'image/svg+xml' }))).toBe(false)
    expect(isCompressibleImage(new Blob([], { type: 'application/pdf' }))).toBe(false)
  })

  it('原图档与不支持的格式原样返回', async () => {
    const png = new File(['png'], 'a.png', { type: 'image/png' })
    const gif = new File(['gif'], 'a.gif', { type: 'image/gif' })
    expect(await compressImage(png, 0)).toBe(png)
    expect(await compressImage(gif, 5)).toBe(gif)
    expect(peekCompressedImage(png, 0)).toBe(png)
    expect(peekCompressedImage(gif, 5)).toBe(gif)
    expect(peekCompressedImage(png, 5)).toBeUndefined()
  })

  it('解码失败时按原图上传，且同一文件同一等级只压缩一次', async () => {
    const broken = new File(['not an image'], 'broken.jpg', { type: 'image/jpeg' })
    const first = compressImage(broken, 5)
    expect(compressImage(broken, 5)).toBe(first)
    expect(await first).toBe(broken)
    expect(peekCompressedImage(broken, 5)).toBe(broken)
  })
})
