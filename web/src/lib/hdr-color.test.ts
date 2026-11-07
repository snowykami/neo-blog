import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeHdrPng, pqEncode, shimmerPosition } from './hdr-color'

function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const result: { type: string, data: Uint8Array }[] = []
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8))
    result.push({ type, data: png.slice(offset + 8, offset + 8 + length) })
    offset += 12 + length
  }
  return result
}

describe('hdr-color', () => {
  it('pq 编码与 BT.2100 参考值一致', () => {
    expect(pqEncode(203)).toBeCloseTo(0.58, 2)
    expect(pqEncode(1000)).toBeCloseTo(0.7518, 3)
    expect(pqEncode(10000)).toBeCloseTo(1, 5)
  })

  it('生成带 cICP 的 2×2 16 位 PNG，像素可解压', () => {
    const png = encodeHdrPng([255, 255, 255], 3)
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const list = chunks(png)
    expect(list.map(c => c.type)).toEqual(['IHDR', 'cICP', 'IDAT', 'IEND'])
    expect(Array.from(list[1].data)).toEqual([9, 16, 0, 1])
    // 2×2（Safari 把 1×1 的图片当纯色画，丢失 HDR）：两行，每行过滤字节 + 2 个像素 × 6 字节
    expect(Array.from(list[0].data.slice(0, 8))).toEqual([0, 0, 0, 2, 0, 0, 0, 2])
    const raw = inflateSync(list[2].data)
    expect(raw.length).toBe(26)
    const sample = (raw[1] << 8) | raw[2]
    // 白色 × 3 ≈ 609 nits
    expect(sample / 0xFFFF).toBeCloseTo(pqEncode(203 * 3), 2)
  })

  it('流光横条的定位让光带中心落在 pos', () => {
    // background-size 300%：p% 把横条左边放在 (100% - 300%) × p%，中心 = 左边 + 150%
    const center = (pos: number) => -2 * Number.parseFloat(shimmerPosition(pos)) + 150
    for (const pos of [-80, 0, 50, 100, 180])
      expect(center(pos)).toBeCloseTo(pos, 0)
  })
})
