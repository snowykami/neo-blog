import type { MusicLyricLine } from './music-lyric'
import { describe, expect, it } from 'vitest'
import { alignExtraLyricLines, getExtraLyricLine, parseMusicLyrics } from './music-lyric'

const line = (startTime: number, text: string): MusicLyricLine => ({ items: [{ text, startTime, duration: 0 }], startTime, duration: 0, originalText: text })

describe('翻译 / 音译挂载（宁缺勿错）', () => {
  const base = [line(0, 'A'), line(2000, 'B'), line(4000, 'C'), line(6000, 'D')]

  it('只挂到时间相近的主行，没有翻译的行不借用相邻行', () => {
    // B、D 没有翻译：不应挂上 A、C 的翻译
    const aligned = alignExtraLyricLines(base, [line(10, 'a'), line(3990, 'c')])
    expect(base.map(item => getExtraLyricLine(aligned, item.startTime)?.originalText ?? null)).toEqual(['a', null, 'c', null])
  })

  it('一行翻译只挂一行主歌词，时间差超出上限的丢弃', () => {
    const aligned = alignExtraLyricLines(base, [line(1000, 'between'), line(9000, 'far')])
    // 1000ms 处与 A、B 等距：只挂一行
    expect(aligned).toHaveLength(1)
    expect(aligned.map(item => item.startTime)).toEqual([expect.any(Number)])
    expect(getExtraLyricLine(aligned, 6000)).toBeNull()
  })

  it('同一主行有多个候选时取时间最近的', () => {
    const aligned = alignExtraLyricLines(base, [line(1800, 'near'), line(2600, 'farther')])
    expect(getExtraLyricLine(aligned, 2000)?.originalText).toBe('near')
    // 次近的那行离 C 也超过上限，被丢弃
    expect(getExtraLyricLine(aligned, 4000)).toBeNull()
  })

  it('解析网易云歌词时翻译与逐字主行对齐', () => {
    const parsed = parseMusicLyrics({
      yrc: { lyric: '[1000,1000](1000,500,0)一(1500,500,0)句\n[3000,1000](3000,1000,0)二', version: 1 },
      tlyric: { lyric: '[00:01.05]line one', version: 1 },
    })
    expect(parsed.sourceType).toBe('yrc')
    expect(getExtraLyricLine(parsed.translationLines, 1000)?.originalText).toBe('line one')
    expect(getExtraLyricLine(parsed.translationLines, 3000)).toBeNull()
  })
})
