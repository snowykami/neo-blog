import type { LyricLine, ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { getStageSignals, SCENE_MAX_LINES } from './stage-effects'

/** 每行 1 秒、间隔 1 秒的歌词：第 i 行在 [2i, 2i+1) 秒演唱 */
function lyricsOf(lines: Partial<LyricLine>[]): ResolvedLyrics {
  return {
    source: 'ncm-yrc',
    wordTimed: true,
    instrumental: false,
    lines: lines.map((extra, i) => ({
      words: [{ text: '词', start: i * 2000, end: i * 2000 + 1000 }],
      start: i * 2000,
      end: i * 2000 + 1000,
      isDuet: false,
      isBackground: false,
      ...extra,
    })),
  }
}

describe('播放器页全屏特效信号', () => {
  it('背景呼吸：唱到 swell / shake 时随起落曲线亮起，其他特效不触发', () => {
    const lyrics = lyricsOf([
      { emphasis: [{ from: 0, to: 1, start: 0, end: 1000, factor: 0.8, effect: 'swell' }] },
      { emphasis: [{ from: 0, to: 1, start: 2000, end: 3000, factor: 1, effect: 'glow' }] },
    ])
    expect(getStageSignals(lyrics, 500).pulse).toBeCloseTo(0.8, 2)
    expect(getStageSignals(lyrics, 1200).pulse).toBe(0)
    expect(getStageSignals(lyrics, 2500).pulse).toBe(0)
  })

  it('背景染色：开始后淡入，唱完后淡出，取最强的颜色', () => {
    const lyrics = lyricsOf([{ emphasis: [{ from: 0, to: 1, start: 0, end: 1000, factor: 0.5, effect: 'glow', color: 'cherry-blossom' }] }])
    expect(getStageSignals(lyrics, 150).tint).toEqual({ color: 'cherry-blossom', strength: 0.5 })
    expect(getStageSignals(lyrics, 800).tint?.strength).toBe(1)
    expect(getStageSignals(lyrics, 1750).tint?.strength).toBeCloseTo(0.5, 2)
    expect(getStageSignals(lyrics, 3000).tint).toBeNull()
  })

  it('粒子场景：从标注行开始，持续若干行，遇到新场景时切换', () => {
    const lines: Partial<LyricLine>[] = Array.from({ length: SCENE_MAX_LINES + 4 }, () => ({}))
    lines[1] = { scene: 'petals' }
    const lyrics = lyricsOf(lines)
    expect(getStageSignals(lyrics, 1500).scene).toBeNull()
    expect(getStageSignals(lyrics, 2000).scene).toBe('petals')
    // 第 1 ~ SCENE_MAX_LINES 行（共 SCENE_MAX_LINES 行）唱完后结束
    const lastLine = SCENE_MAX_LINES
    expect(getStageSignals(lyrics, lastLine * 2000 + 500).scene).toBe('petals')
    expect(getStageSignals(lyrics, lastLine * 2000 + 1500).scene).toBeNull()

    lines[3] = { scene: 'snow' }
    expect(getStageSignals(lyricsOf(lines), 6500).scene).toBe('snow')
  })
})
