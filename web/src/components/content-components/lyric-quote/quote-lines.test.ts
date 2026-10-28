import type { MusicLyricLine } from '@/utils/music-lyric'
import { describe, expect, it } from 'vitest'
import { buildQuoteLyrics, cleanLyricLines, getSnippetEndMs, isLyricCreditLine, resolveQuoteLines } from './quote-lines'

const line = (startTime: number, originalText: string, duration = 0): MusicLyricLine => ({ items: [], startTime, duration, originalText })

const LINES = [
  line(0, '作词 : 某人'),
  line(1000, '作曲：某人'),
  line(4000, '风吹过空荡的街'),
  line(8000, '我们曾在这里告别'),
  line(12000, '月光落在你的肩'),
  line(16000, '副歌'),
  line(20000, '我们曾在这里告别'),
  line(24000, '月光落在你的肩'),
]

describe('歌词摘录选句', () => {
  it('过滤署名行与占位文本，保留正文中带冒号的句子', () => {
    expect(isLyricCreditLine('作词 : 某人')).toBe(true)
    expect(isLyricCreditLine('Composer: Someone')).toBe(true)
    expect(isLyricCreditLine('他说：明天见')).toBe(false)
    const cleaned = cleanLyricLines([...LINES, line(30000, 'no_lyric'), line(31000, '他说：明天见')])
    expect(cleaned.map(item => item.originalText)).toEqual([
      '风吹过空荡的街',
      '我们曾在这里告别',
      '月光落在你的肩',
      '副歌',
      '我们曾在这里告别',
      '月光落在你的肩',
      '他说：明天见',
    ])
  })

  it('按时间取到的句子与快照一致时直接使用', () => {
    const lines = cleanLyricLines(LINES)
    const resolved = resolveQuoteLines(lines, 8000, 12000, '我们曾在这里告别\n月光落在你的肩')
    expect(resolved?.map(item => item.startTime)).toEqual([8000, 12000])
  })

  it('歌词时间偏移后按快照文本重新定位，重复段落取离原时间最近的一处', () => {
    const shifted = cleanLyricLines(LINES).map(item => ({ ...item, startTime: item.startTime + 1500 }))
    expect(resolveQuoteLines(shifted, 8000, 12000, '我们曾在这里告别\n月光落在你的肩')?.map(item => item.startTime)).toEqual([9500, 13500])
    expect(resolveQuoteLines(shifted, 20000, 24000, '我们曾在这里告别\n月光落在你的肩')?.map(item => item.startTime)).toEqual([21500, 25500])
  })

  it('歌词中找不到快照文本时返回 null（只展示快照），没有快照时按时间取', () => {
    const lines = cleanLyricLines(LINES)
    expect(resolveQuoteLines(lines, 8000, 0, '已经改掉的一句')).toBeNull()
    expect(resolveQuoteLines(lines, 8000, 0, '')?.map(item => item.originalText)).toEqual(['我们曾在这里告别'])
    expect(resolveQuoteLines([], 8000, 0, '')).toBeNull()
  })

  it('片段结束时间：最后一句的时长或下一句的开始；只有快照时按结束句估算', () => {
    const lines = cleanLyricLines(LINES)
    expect(getSnippetEndMs(lines, lines.slice(1, 3), 8000, 12000)).toBe(16000)
    expect(getSnippetEndMs(lines, [line(12000, 'x', 2500)], 12000, 0)).toBe(14500)
    expect(getSnippetEndMs(lines, [], 8000, 12000)).toBe(17000)
  })
})

describe('摘录使用的歌词', () => {
  const online = {
    lines: [line(1000, '一'), line(3000, '二')],
    translationLines: [line(1000, 'one')],
    romajiLines: [line(3000, 'ni')],
  }

  it('没有手填歌词时使用统一的在线歌词，手填翻译覆盖在线翻译', () => {
    const result = buildQuoteLyrics({ online, authorLyric: '', translation: '[00:03.00]two', romaji: '' })
    expect(result.lines.map(item => item.originalText)).toEqual(['一', '二'])
    expect(result.translationLines.map(item => [item.startTime, item.originalText])).toEqual([[3000, 'two']])
    expect(result.romajiLines).toBe(online.romajiLines)
  })

  it('手填原歌词优先，在线翻译按时间挂到手填的行上', () => {
    const result = buildQuoteLyrics({ online, authorLyric: '[00:01.10]甲\n[00:03.10]乙', translation: '', romaji: '' })
    expect(result.lines.map(item => item.originalText)).toEqual(['甲', '乙'])
    expect(result.translationLines.map(item => [item.startTime, item.originalText])).toEqual([[1100, 'one']])
  })
})
