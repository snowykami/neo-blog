import { describe, expect, it } from 'vitest'
import { interludeDot } from './interlude'

// 10 秒的间奏：0 ~ 10000ms
const at = (t: number, i: number) => interludeDot(0, 10_000, t, i, 3)

describe('间奏圆点', () => {
  it('间奏外不可见', () => {
    expect(at(-1, 0).opacity).toBe(0)
    expect(at(10_000, 0).opacity).toBe(0)
  })

  it('依次淡入，先以未点亮的低透明度出现', () => {
    expect(at(0, 0).opacity).toBe(0)
    expect(at(900, 0).opacity).toBeCloseTo(0.1, 2)
    expect(at(900, 2).opacity).toBeLessThan(at(900, 0).opacity)
  })

  it('倒计时：按时间依次点亮，淡出前全部点亮', () => {
    // 点亮区间为 1000 ~ 8200ms，每个点约 2400ms
    expect(at(2000, 0).opacity).toBeGreaterThan(0.4)
    expect(at(2000, 1).opacity).toBeCloseTo(0.1, 2)
    expect(at(8100, 2).opacity).toBeGreaterThan(0.9)
  })

  it('呼吸在吸气与呼气之间交替', () => {
    const scales = [1500, 3000, 4500, 6000, 7500].map(t => at(t, 1).scale)
    expect(Math.max(...scales)).toBeGreaterThan(1.1)
    expect(Math.min(...scales)).toBeLessThan(1)
  })

  it('退场：先放大，随后缩小并淡出', () => {
    expect(at(9000, 1).scale).toBeGreaterThan(1.15)
    expect(at(9700, 1).scale).toBeLessThan(0.5)
    expect(at(9600, 1).opacity).toBeLessThan(0.05)
  })
})
