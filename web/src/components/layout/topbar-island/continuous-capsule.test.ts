import { describe, expect, it } from 'vitest'
import { CONTINUOUS_CAPSULE_MIN_ASPECT, continuousCapsulePath } from './continuous-capsule'

function numbers(path: string) {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

describe('continuousCapsulePath', () => {
  it('太窄或尺寸无效时不生成，保留普通圆角', () => {
    expect(continuousCapsulePath(36, 36)).toBeNull()
    expect(continuousCapsulePath(36 * CONTINUOUS_CAPSULE_MIN_ASPECT - 1, 36)).toBeNull()
    expect(continuousCapsulePath(0, 36)).toBeNull()
    expect(continuousCapsulePath(200, 0)).toBeNull()
  })

  it('生成闭合路径：两端各一段圆弧、四段过渡贝塞尔，坐标都在盒子之内', () => {
    const path = continuousCapsulePath(240, 36)!
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
    expect(path.match(/A/g)).toHaveLength(2)
    expect(path.match(/C/g)).toHaveLength(4)
    for (const value of numbers(path.replace(/A[\d.]+ [\d.]+ 0 0 1/g, 'A')))
      expect(value >= 0 && value <= 240).toBe(true)
  })

  it('左右对称：直边起止点与两端最远处的 x 关于中线对称', () => {
    const width = 300
    const path = continuousCapsulePath(width, 36)!
    const [startX] = numbers(path)
    const right = Number(path.match(/H([\d.]+)/)![1])
    expect(startX + right).toBeCloseTo(width, 1)
    // 过渡起点按 Apple 的 1.528665r 放置（半高 18px）
    expect(startX).toBeCloseTo(18 * 1.5266, 1)
  })
})
