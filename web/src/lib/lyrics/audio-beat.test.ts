import { describe, expect, it } from 'vitest'
import { beatStep } from './audio-beat'

describe('节拍检测', () => {
  it('能量突然升高时触发节拍，之后衰减', () => {
    let state = { average: 0, level: 0 }
    // 平稳的能量：建立平均值，不触发
    for (let i = 0; i < 120; i++)
      state = beatStep(state, 0.3, 1 / 60)
    expect(state.level).toBeLessThan(0.05)
    // 鼓点：能量突增
    state = beatStep(state, 0.6, 1 / 60)
    expect(state.level).toBeGreaterThan(0.5)
    const peak = state.level
    for (let i = 0; i < 30; i++)
      state = beatStep(state, 0.3, 1 / 60)
    expect(state.level).toBeLessThan(peak * 0.1)
  })
})
