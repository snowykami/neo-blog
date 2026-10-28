import type { LyricEmphasis } from './types'
import { describe, expect, it } from 'vitest'
import { navEmphasisStyle } from './nav-emphasis'
import { holdVibrato, vibratoWave } from './vibrato'

// 「出した」：长音「た」从 1.2 秒唱到 3.3 秒（2.1 秒）
const HELD: LyricEmphasis = { from: 0, to: 3, start: 600, end: 3300, factor: 1, effect: 'shake', hold: { start: 1200, end: 3300 } }

describe('长音的颤音', () => {
  it('长音开唱后延迟「音长 × 20%」才开始颤，渐强，唱完后收住', () => {
    const hold = HELD.hold!
    expect(holdVibrato(hold, 1200).onset).toBe(1620)
    expect(holdVibrato(hold, 1500).amount).toBe(0)
    expect(holdVibrato(hold, 1800).amount).toBeCloseTo(0.5)
    expect(holdVibrato(hold, 2500).amount).toBe(1)
    expect(holdVibrato(hold, 3450).amount).toBeCloseTo(0.5)
    expect(holdVibrato(hold, 3700).amount).toBe(0)
  })

  it('节奏：慢歌颤得慢、开始得晚，快歌颤得快、开始得早', () => {
    const hold = { start: 0, end: 2000 }
    expect(holdVibrato(hold, 0, 'slow').onset).toBeGreaterThan(holdVibrato(hold, 0, 'fast').onset)
    // 半个周期后过零：快的周期更短
    const zero = (pace: 'slow' | 'fast') => 1000 / (pace === 'slow' ? 4.8 : 6.5) / 2
    expect(Math.abs(vibratoWave(zero('fast'), 0, 0, 'fast'))).toBeLessThan(1e-9)
    expect(Math.abs(vibratoWave(zero('slow'), 0, 0, 'slow'))).toBeLessThan(1e-9)
    expect(zero('fast')).toBeLessThan(zero('slow'))
  })

  it('延迟限制在 250～700 毫秒', () => {
    expect(holdVibrato({ start: 0, end: 1000 }, 0).onset).toBe(250)
    expect(holdVibrato({ start: 0, end: 6000 }, 0).onset).toBe(700)
  })
})

describe('导航栏的简化特效', () => {
  it('长音在颤音开始前只放大，开始后整个词上下起伏', () => {
    const before = navEmphasisStyle(HELD, 2, 3, 1500, true)
    expect(before.transform).toMatch(/translate\(0\.000em, 0\.000em\) scale\(1\.0\d+\)/)
    const during = [2000, 2050, 2100].map(time => navEmphasisStyle(HELD, 2, 3, time, true).transform)
    expect(during.some(transform => !transform.includes(', 0.000em)'))).toBe(true)
  })

  it('减少动态效果或强度为 0 时只上色', () => {
    const colored: LyricEmphasis = { ...HELD, effect: 'swell', color: 'gold', hold: undefined }
    for (const style of [navEmphasisStyle(colored, 0, 3, 1500, false), navEmphasisStyle({ ...colored, factor: 0 }, 0, 3, 1500, true)]) {
      expect(style.transform).toBe('')
      expect(style.textShadow).toBe('')
      expect(style.color).toContain('color-mix')
    }
  })
})
