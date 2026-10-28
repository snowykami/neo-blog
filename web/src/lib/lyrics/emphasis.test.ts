import type { LyricLine, ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { applyEmphasis, lineEmphasis } from './emphasis'

/** 由 [字, 开始, 结束] 组成的逐字歌词行 */
function line(words: [string, number, number][]): LyricLine {
  return {
    words: words.map(([text, start, end]) => ({ text, start, end })),
    start: words[0][1],
    end: words[words.length - 1][2],
    isDuet: false,
    isBackground: false,
  }
}

// 《毕业通知》（AMLL TTML DB）中的一句：「怦然心动」四个字合计约 1.87 秒，但每个字都不到 1 秒
const HEARTBEAT = line([
  ['图', 147_700, 148_044],
  ['书', 148_044, 148_440],
  ['馆', 148_440, 148_610],
  ['偏', 150_227, 150_569],
  ['怦', 150_569, 150_995],
  ['然', 150_995, 151_172],
  ['心', 151_172, 151_680],
  ['动', 151_680, 152_440],
])

describe('歌词强调', () => {
  it('规则：词唱满 1 秒才强调，强度随时长增加，行尾加强', () => {
    const groups = lineEmphasis(line([['见', 0, 1499], ['你', 1500, 1700]]))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ from: 0, to: 1, effect: 'swell' })
    expect(groups[0].factor).toBeCloseTo(0.499, 2)

    const last = lineEmphasis(line([['你', 0, 200], ['见', 200, 1700]]))
    expect(last[0].factor).toBeCloseTo(0.5 * 1.3, 2)
  })

  it('拉丁文字：单个字母不强调，短单词按词判断', () => {
    expect(lineEmphasis(line([['a ', 0, 1500], ['day', 1500, 1600]]))).toEqual([])
    const groups = lineEmphasis(line([['lo', 0, 600], ['ve ', 600, 1600], ['me', 1600, 1700]]))
    expect(groups).toMatchObject([{ from: 0, to: 2 }])
  })

  it('浏览器分词切不出「怦然心动」时规则不触发，标注的短语可以补上，并指定特效', () => {
    expect(lineEmphasis(HEARTBEAT)).toEqual([])
    const groups = lineEmphasis(HEARTBEAT, { text: '图书馆偏怦然心动', phrases: [{ text: '怦然心动', effect: 'glow' }] })
    expect(groups).toMatchObject([{ from: 4, to: 8, effect: 'glow', start: 150_569, end: 152_440 }])
    expect(groups[0].factor).toBe(1)
  })

  it('标注的短语唱得太短时不演出，标注不改变任何时间', () => {
    expect(lineEmphasis(HEARTBEAT, { text: '', phrases: [{ text: '馆', effect: 'swell' }] })).toEqual([])
    const lyrics: ResolvedLyrics = { source: 'ttml-amll', wordTimed: true, instrumental: false, lines: [HEARTBEAT] }
    const result = applyEmphasis(lyrics, { lines: [{ text: '图书馆，偏怦然心动！', mood: 'bright', phrases: [{ text: '怦然心动', effect: 'swell' }] }] })
    expect(result.lines[0].mood).toBe('bright')
    expect(result.lines[0].emphasis).toHaveLength(1)
    expect(result.lines[0].words).toEqual(HEARTBEAT.words)
    expect([result.lines[0].start, result.lines[0].end]).toEqual([HEARTBEAT.start, HEARTBEAT.end])
  })

  it('shake 短语中唱满 1 秒的最长音节记为长音（颤音），其他特效与短音不记', () => {
    const held = line([['連', 0, 300], ['れ', 300, 600], ['出', 600, 900], ['し', 900, 1200], ['た', 1200, 3300]])
    const phrase = (effect: 'shake' | 'glow') => ({ text: '連れ出した', phrases: [{ text: '出した', effect }] })
    expect(lineEmphasis(held, phrase('shake'))[0]).toMatchObject({ from: 2, to: 5, effect: 'shake', hold: { start: 1200, end: 3300 } })
    expect(lineEmphasis(held, phrase('glow'))[0].hold).toBeUndefined()
    const short = line([['連', 0, 300], ['れ', 300, 600], ['出', 600, 900], ['し', 900, 1200], ['た', 1200, 1900]])
    expect(lineEmphasis(short, phrase('shake'))[0].hold).toBeUndefined()
  })

  it('逐行歌词不处理', () => {
    const lyrics: ResolvedLyrics = { source: 'ncm-lrc', wordTimed: false, instrumental: false, lines: [line([['一句歌词', 0, 5000]])] }
    expect(applyEmphasis(lyrics)).toBe(lyrics)
  })
})
