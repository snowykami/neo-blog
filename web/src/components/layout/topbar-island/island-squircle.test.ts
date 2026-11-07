import { describe, expect, it } from 'vitest'
import { PANEL_CORNER_RADIUS, PANEL_CORNER_SMOOTHING, squirclePath } from './island-squircle'

function numbers(path: string) {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

describe('squirclePath', () => {
  it('尺寸无效时不生成，保留普通圆角', () => {
    expect(squirclePath(0, 218)).toBeNull()
    expect(squirclePath(352, 0)).toBeNull()
    expect(squirclePath(-10, 218)).toBeNull()
  })

  it('生成闭合路径，坐标都是有限值', () => {
    const path = squirclePath(352, 218)!
    expect(path.startsWith('M')).toBe(true)
    expect(path.trim().endsWith('Z')).toBe(true)
    for (const value of numbers(path))
      expect(Number.isFinite(value)).toBe(true)
  })

  it('过渡段沿直边延长：直边起点比正圆弧的拐点更靠里，说明曲率是连续升上去的', () => {
    const width = 352
    const path = squirclePath(width, 218)!
    // 路径从右上角的过渡起点开始：正圆弧从 radius 处开始拐，连续曲率的过渡段沿直边延长到 (1 + 平滑度) 倍
    const [startX] = numbers(path)
    expect(startX).toBeCloseTo(width - PANEL_CORNER_RADIUS * (1 + PANEL_CORNER_SMOOTHING), 1)
    expect(startX).toBeLessThan(width - PANEL_CORNER_RADIUS)
  })

  it('与正圆弧保持同一个半径：仍含一段 radius 的圆弧', () => {
    const path = squirclePath(352, 218)!
    expect(path).toMatch(new RegExp(`a ${PANEL_CORNER_RADIUS}(?:\\.0+)? ${PANEL_CORNER_RADIUS}(?:\\.0+)? 0 0 1`))
  })

  it('平滑度取 iOS 观感的那一档', () => {
    expect(PANEL_CORNER_SMOOTHING).toBe(0.6)
  })
})
