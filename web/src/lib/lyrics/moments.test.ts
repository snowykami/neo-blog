import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { resolveNotes, resolveSpotlights } from './emphasis'
import { lyricMomentAt } from './moments'

function lyrics(spans: [number, number][], extra: Partial<ResolvedLyrics> = {}, texts?: string[]): ResolvedLyrics {
  return {
    source: 'ncm-yrc',
    wordTimed: true,
    instrumental: false,
    lines: spans.map(([start, end], i) => ({ words: [{ text: texts?.[i] ?? '词', start, end }], start, end, isDuet: false, isBackground: false })),
    ...extra,
  }
}

describe('歌词区底部的「时刻」', () => {
  const song = lyrics([[10_000, 12_000], [20_000, 25_000]], { intro: '导语', outro: { content: '热评', liked: 1 } })

  it('前奏导语：显示到开唱前，前奏较短时也至少显示 8 秒', () => {
    expect(lyricMomentAt(song, 100, 60_000)).toBeNull()
    expect(lyricMomentAt(song, 5000, 60_000)).toBe('intro')
    expect(lyricMomentAt(song, 9600, 60_000)).toBeNull()
    const short = lyrics([[2000, 3000], [9000, 9500]], { intro: '导语' })
    expect(lyricMomentAt(short, 7000, 60_000)).toBe('intro')
    expect(lyricMomentAt(short, 8400, 60_000)).toBeNull()
  })

  it('尾奏热评：最后一句唱完不久后显示，直到歌曲结束前', () => {
    expect(lyricMomentAt(song, 25_500, 60_000)).toBeNull()
    expect(lyricMomentAt(song, 26_000, 60_000)).toBe('outro')
    expect(lyricMomentAt(song, 59_800, 60_000)).toBeNull()
  })

  it('关键节点：开唱时显示约 9 秒，遇到下一个时刻或尾奏提前让位，优先于导语', () => {
    const noted = lyrics([[5000, 8000], [20_000, 22_000], [24_000, 30_000]], {
      intro: '导语',
      outro: { content: '热评', liked: 1 },
      notes: [{ start: 5000, content: 'a', source: 'ai' }, { start: 20_000, content: 'b', source: 'comment', liked: 3 }, { start: 24_000, content: 'c', source: 'ai' }],
    })
    expect(lyricMomentAt(noted, 3000, 60_000)).toBe('intro')
    expect(lyricMomentAt(noted, 6000, 60_000)).toBe('note:0')
    expect(lyricMomentAt(noted, 15_000, 60_000)).toBeNull()
    expect(lyricMomentAt(noted, 21_000, 60_000)).toBe('note:1')
    expect(lyricMomentAt(noted, 24_500, 60_000)).toBe('note:2')
    expect(lyricMomentAt(noted, 31_000, 60_000)).toBe('outro')
  })

  it('时刻按文字匹配到第几次出现的歌词行', () => {
    const lines = lyrics([[1000, 2000], [3000, 4000], [5000, 6000]], {}, ['副歌', '主歌', '副歌！']).lines
    expect(resolveNotes(lines, [
      { text: '副歌', occurrence: 1, content: '第二次', source: 'ai' },
      { text: '不存在', occurrence: 0, content: 'x', source: 'ai' },
      { text: '副歌', occurrence: 5, content: '超出取最后', source: 'comment', liked: 2 },
    ])).toEqual([
      { start: 5000, content: '第二次', source: 'ai', liked: undefined },
      { start: 5000, content: '超出取最后', source: 'comment', liked: 2 },
    ])
    expect(resolveNotes(lines, [])).toBeUndefined()
  })

  it('聚光灯按文字匹配到每次出现的行号，找不到时为空', () => {
    const lines = lyrics([[1000, 2000], [3000, 4000], [5000, 6000], [7000, 8000]], {}, ['副歌', '主歌', '副歌！', '尾声']).lines
    expect(resolveSpotlights(lines, ['副歌'])).toEqual([0, 2])
    expect(resolveSpotlights(lines, ['尾声', '主歌', '不存在'])).toEqual([1, 3])
    expect(resolveSpotlights(lines, ['不存在'])).toBeUndefined()
    expect(resolveSpotlights(lines)).toBeUndefined()
  })
})
