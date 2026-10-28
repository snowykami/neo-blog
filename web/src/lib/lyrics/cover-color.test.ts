import { describe, expect, it } from 'vitest'
import { pickAccent } from './cover-color'

/** 由若干 [r, g, b, 数量] 组成的像素 */
function pixels(groups: [number, number, number, number][]) {
  const data: number[] = []
  for (const [r, g, b, count] of groups) {
    for (let i = 0; i < count; i++)
      data.push(r, g, b, 255)
  }
  return data
}

describe('封面取色', () => {
  it('取权重最大的色相，并提亮到统一亮度', () => {
    // 大片灰色背景上的一块红色：灰色不参与，主色为红
    const accent = pickAccent(pixels([[128, 128, 128, 80], [200, 40, 40, 20], [40, 60, 200, 5]]))
    expect(accent).not.toBeNull()
    const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(accent!.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
    expect(r).toBeGreaterThan(200)
  })

  it('封面近乎无彩色时返回 null', () => {
    expect(pickAccent(pixels([[30, 30, 30, 50], [240, 240, 240, 50]]))).toBeNull()
    expect(pickAccent([])).toBeNull()
  })
})
