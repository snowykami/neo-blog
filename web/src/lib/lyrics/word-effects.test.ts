import { describe, expect, it } from 'vitest'
import { getStageSignals } from './stage-effects'
import { dissolveState, heartbeatLevel, shimmerCenter } from './word-effects'

describe('消散、流光与心跳', () => {
  it('心跳：每拍「扑通-扑通」两下，第二下稍弱；唱完后停止', () => {
    // 1.5 秒分成 2 拍，每拍 750ms，第二下在拍内约 165ms 处
    expect(heartbeatLevel(0, 1500, 50)).toBeGreaterThan(0.55)
    expect(heartbeatLevel(0, 1500, 215)).toBeGreaterThan(0.4)
    expect(heartbeatLevel(0, 1500, 215)).toBeLessThan(heartbeatLevel(0, 1500, 50))
    expect(heartbeatLevel(0, 1500, 600)).toBeLessThan(0.05)
    expect(heartbeatLevel(0, 1500, 800)).toBeGreaterThan(0.55)
    expect(heartbeatLevel(0, 1500, 2000)).toBe(0)
  })

  it('流光：唱到时从左扫到右，扫两遍后停止', () => {
    expect(shimmerCenter(1000, 900, 4)).toBeNull()
    expect(shimmerCenter(1000, 1000, 4)).toBe(-1)
    expect(shimmerCenter(1000, 1475, 4)).toBeCloseTo(2)
    expect(shimmerCenter(1000, 1000 + 950 * 1.5, 4)).toBeCloseTo(2)
    expect(shimmerCenter(1000, 1000 + 950 * 2, 4)).toBeNull()
  })

  it('消散：每个字唱完后依次淡出，保持很久再慢慢恢复', () => {
    // 4 个字唱 0 ~ 2000ms，第 1 个字 500ms 唱完，650ms 开始消散
    expect(dissolveState(0, 2000, 0, 4, 600).amount).toBe(0)
    expect(dissolveState(0, 2000, 0, 4, 950).amount).toBeCloseTo(0.5)
    expect(dissolveState(0, 2000, 0, 4, 1300).amount).toBe(1)
    expect(dissolveState(0, 2000, 3, 4, 1300).amount).toBe(0)
    expect(dissolveState(0, 2000, 0, 4, 650 + 10000).amount).toBe(1)
    expect(dissolveState(0, 2000, 0, 4, 650 + 12000 + 750).amount).toBeCloseTo(0.5)
    expect(dissolveState(0, 2000, 0, 4, 650 + 14000).amount).toBe(0)
  })

  it('消散：拖动进度后，落点之前就该消散的字直接显示；落点之后的照常消散', () => {
    // 拖到 1800ms：第 1、2 个字（650ms、1150ms 开始消散）显示，第 3 个字（1650ms）也在落点前，第 4 个字（2150ms）照常
    expect(dissolveState(0, 2000, 0, 4, 2000, 1800).amount).toBe(0)
    expect(dissolveState(0, 2000, 2, 4, 2000, 1800).amount).toBe(0)
    expect(dissolveState(0, 2000, 3, 4, 2750, 1800).amount).toBe(1)
  })

  it('镜头推近：副歌起点开唱后推近，再缓缓回落', () => {
    const lyrics = {
      source: 'ttml-amll' as const,
      wordTimed: true,
      instrumental: false,
      lines: [{ words: [{ text: '副歌', start: 1000, end: 2000 }], start: 1000, end: 2000, isDuet: false, isBackground: false, chorusStart: true }],
    }
    expect(getStageSignals(lyrics, 900).push).toBe(0)
    expect(getStageSignals(lyrics, 1450).push).toBe(1)
    expect(getStageSignals(lyrics, 1450 + 1300).push).toBeCloseTo(0.5)
    expect(getStageSignals(lyrics, 1450 + 2700).push).toBe(0)
  })
})
