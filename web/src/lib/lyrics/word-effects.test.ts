import { describe, expect, it } from 'vitest'
import { rayToRect } from './lyric-debris'
import { getStageSignals } from './stage-effects'
import { dissolveState, heartbeatLevel, shatterFlash, shatterState, shimmerCenter } from './word-effects'

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

  it('节奏：快的心跳拍子更密、流光扫得更快、消散淡出更快；慢的反之', () => {
    // 3 秒：慢 1000ms 一拍（3 拍），中 750ms（4 拍），快 520ms（6 拍）；拍首附近最强
    const beatsOf = (pace: 'slow' | 'medium' | 'fast') => [...Array.from({ length: 3000 / 10 }).keys()].filter(i => heartbeatLevel(0, 3000, i * 10, pace) > 0.5 && heartbeatLevel(0, 3000, i * 10 - 10, pace) <= 0.5).length
    expect(beatsOf('slow')).toBeLessThan(beatsOf('medium'))
    expect(beatsOf('medium')).toBeLessThan(beatsOf('fast'))
    // 扫两遍：快的 1.3 秒就扫完，同一时刻中速仍在扫
    expect(shimmerCenter(0, 1300, 4, 'fast')).toBeNull()
    expect(shimmerCenter(0, 1300, 4, 'medium')).not.toBeNull()
    expect(shimmerCenter(0, 1400 * 1.5, 4, 'slow')).not.toBeNull()
    expect(dissolveState(0, 2000, 0, 4, 650 + 350, undefined, 'fast').amount).toBe(1)
    expect(dissolveState(0, 2000, 0, 4, 650 + 350, undefined, 'slow').amount).toBeCloseTo(0.35)
  })

  it('破碎：整个词唱完 60ms 后一起碎，碎前 140ms 渐强地颤，碎后保持隐去再慢慢恢复', () => {
    // 词在 2000ms 唱完，2060ms 碎
    expect(shatterState(2000, 1900)).toEqual({ at: 2060, crack: 0, amount: 0 })
    expect(shatterState(2000, 1990).crack).toBeCloseTo(0.5)
    expect(shatterState(2000, 2060)).toEqual({ at: 2060, crack: 0, amount: 1 })
    expect(shatterState(2000, 2060 + 10000).amount).toBe(1)
    expect(shatterState(2000, 2060 + 12000 + 750).amount).toBeCloseTo(0.5)
    expect(shatterState(2000, 2060 + 12000 + 1500).amount).toBe(0)
    // 跳转落点之后才碎的照常碎，之前就该碎的直接显示
    expect(shatterState(2000, 3000, 1500).amount).toBe(1)
    expect(shatterState(2000, 3000, 2500)).toEqual({ at: 2060, crack: 0, amount: 0 })
  })

  it('破碎的闪光：碎的一瞬间亮满，随后衰减', () => {
    expect(shatterFlash(2000, 2050)).toBe(0)
    expect(shatterFlash(2000, 2060)).toBe(1)
    expect(shatterFlash(2000, 2280)).toBeCloseTo(Math.exp(-1))
    expect(shatterFlash(2000, 4000)).toBe(0)
    const lyrics = { source: 'ncm-yrc' as const, wordTimed: true, instrumental: false, lines: [{ words: [{ text: '碎了', start: 0, end: 2000 }], start: 0, end: 2000, isDuet: false, isBackground: false, emphasis: [{ from: 0, to: 1, start: 0, end: 2000, factor: 0.8, effect: 'shatter' as const }] }] }
    expect(getStageSignals(lyrics, 2060).pulse).toBeCloseTo(0.8)
  })

  it('碎片：从裂点出发的射线与字框的交点', () => {
    expect(rayToRect(10, 10, 0, 40, 20)).toEqual([40, 10])
    const [x, y] = rayToRect(10, 10, Math.PI / 2, 40, 20)
    expect(x).toBeCloseTo(10)
    expect(y).toBeCloseTo(20)
    const [x2, y2] = rayToRect(10, 10, Math.PI * 1.25, 40, 20)
    expect(x2).toBeCloseTo(0)
    expect(y2).toBeCloseTo(0)
  })
})
