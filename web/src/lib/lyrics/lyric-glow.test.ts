import type { LyricLine, ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { LYRIC_COLORS, MOOD_GLOW } from './colors'
import { lyricGlowAt } from './lyric-glow'

/** 每行 3 秒、间隔 1 秒：第 i 行在 [4i, 4i+3) 秒演唱 */
function lyricsOf(lines: Partial<LyricLine>[], extra: Partial<ResolvedLyrics> = {}): ResolvedLyrics {
  return {
    source: 'ncm-yrc',
    wordTimed: true,
    instrumental: false,
    lines: lines.map((line, i) => ({
      words: [{ text: '词', start: i * 4000, end: i * 4000 + 3000 }],
      start: i * 4000,
      end: i * 4000 + 3000,
      isDuet: false,
      isBackground: false,
      ...line,
    })),
    ...extra,
  }
}

describe('lyricGlowAt', () => {
  it('优先取此刻在唱的强调短语的颜色，其次是这一行情绪的辉光色', () => {
    const lyrics = lyricsOf([
      { mood: 'sad', emphasis: [{ from: 0, to: 1, start: 1000, end: 1200, factor: 0, effect: 'swell', color: 'sky' }] },
    ])
    expect(lyricGlowAt(lyrics, 500)).toEqual({ color: MOOD_GLOW.sad, strong: false })
    // 唱得很快的短语也停留到最短演出时长（1 秒）
    expect(lyricGlowAt(lyrics, 1900)).toEqual({ color: LYRIC_COLORS.sky, strong: false })
    expect(lyricGlowAt(lyrics, 2100)).toEqual({ color: MOOD_GLOW.sad, strong: false })
  })

  it('唱到带特效的强调或点题句时为高亮', () => {
    const lyrics = lyricsOf([
      { emphasis: [{ from: 0, to: 1, start: 500, end: 2500, factor: 0.6, effect: 'glow' }] },
      {},
    ], { spotlights: [1] })
    expect(lyricGlowAt(lyrics, 200).strong).toBe(false)
    expect(lyricGlowAt(lyrics, 1000)).toEqual({ color: null, strong: true })
    expect(lyricGlowAt(lyrics, 4500)).toEqual({ color: null, strong: true })
  })

  it('间隙与只有背景和声在唱时没有颜色', () => {
    const lyrics = lyricsOf([{ mood: 'bright' }, { mood: 'calm', isBackground: true }])
    expect(lyricGlowAt(lyrics, 3500)).toEqual({ color: null, strong: false })
    expect(lyricGlowAt(lyrics, 4500)).toEqual({ color: null, strong: false })
  })
})
