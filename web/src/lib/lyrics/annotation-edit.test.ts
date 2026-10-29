import type { PhraseForm } from './annotation-edit'
import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { addPhrase, fromAnnotationForm, lineSegments, phraseRanges, toAnnotationForm, trimSelection, uniqueLyricLines } from './annotation-edit'
import { formatLyricOffset, shiftLyrics } from './offset'

const swell: Omit<PhraseForm, 'text'> = { effect: 'swell', color: '', font: '', styles: [], pace: '' }

describe('歌词特效编辑器', () => {
  it('按文本去重，记下每行在完整歌词中的行号', () => {
    expect(uniqueLyricLines(['副歌', '主歌', '副歌'])).toEqual([{ text: '副歌', indices: [0, 2] }, { text: '主歌', indices: [1] }])
  })

  it('短语在行内每次出现都演出；重叠时先出现的短语优先', () => {
    expect(phraseRanges('爱你爱你', '爱你')).toEqual([[0, 2], [2, 4]])
    const segments = lineSegments('我爱你 爱你', [{ text: '爱你' }, { text: '我爱' }])
    expect(segments.map(s => [s.text, s.phrase])).toEqual([['我', undefined], ['爱你', 0], [' ', undefined], ['爱你', 0]])
  })

  it('选区去掉两端空白；新短语替换重叠或同文本的旧短语', () => {
    expect(trimSelection('  樱花 ', 0, 5)).toEqual([2, 4])
    expect(trimSelection('a  b', 1, 3)).toBeNull()
    const line = '樱花飘落的季节'
    const phrases = [{ ...swell, text: '樱花' }, { ...swell, text: '季节' }]
    // 选中「花飘落」与「樱花」重叠
    expect(addPhrase(line, phrases, 1, 4, { ...swell, effect: 'glow' }).map(p => [p.text, p.effect])).toEqual([['季节', 'swell'], ['花飘落', 'glow']])
    // 选中同一文本即替换
    expect(addPhrase(line, phrases, 5, 7, { ...swell, effect: 'shatter' }).map(p => [p.text, p.effect])).toEqual([['樱花', 'swell'], ['季节', 'shatter']])
  })

  it('表单与后端格式互转：聚光灯换算成行号，空字段与没有标注的行不保存', () => {
    const lines = ['樱花', '再见', '樱花']
    const form = toAnnotationForm(lines, {
      font: 'kai',
      pace: 'slow',
      spotlight: { text: '樱花', occurrence: 1 },
      lines: [{ text: '樱花', chorusStart: true, phrases: [{ text: '樱花', effect: 'glow', color: 'cherry-blossom' }] }],
    })
    expect(form.spotlight).toBe(2)
    expect(form.lines).toHaveLength(2)
    expect(form.lines[0]).toMatchObject({ chorus: true, chorusStart: true, phrases: [{ text: '樱花', effect: 'glow', color: 'cherry-blossom', font: '', styles: [], pace: '' }] })
    expect(fromAnnotationForm(lines, { ...form, pace: 'medium', intro: '  春天  ' })).toEqual({
      font: 'kai',
      pace: undefined,
      intro: '春天',
      spotlight: { text: '樱花', occurrence: 1 },
      lines: [{ text: '樱花', chorus: true, chorusStart: true, phrases: [{ text: '樱花', effect: 'glow', color: 'cherry-blossom' }] }],
    })
    expect(fromAnnotationForm(lines, { ...form, spotlight: null }).spotlight).toBeNull()
  })
})

describe('歌词整体偏移', () => {
  const lyrics: ResolvedLyrics = {
    source: 'ncm-yrc',
    wordTimed: true,
    instrumental: false,
    lines: [{ words: [{ text: '你', start: 1000, end: 1400 }], start: 900, end: 1400, isDuet: false, isBackground: false }],
  }

  it('平移行与词的时间；为 0 时原样返回', () => {
    const shifted = shiftLyrics(lyrics, 300)
    expect(shifted.lines[0]).toMatchObject({ start: 1200, end: 1700, words: [{ start: 1300, end: 1700 }] })
    expect(shiftLyrics(lyrics, 0)).toBe(lyrics)
  })

  it('显示为带正负号的秒', () => {
    expect(formatLyricOffset(300)).toBe('+0.3s')
    expect(formatLyricOffset(-1200)).toBe('-1.2s')
    expect(formatLyricOffset(0)).toBe('0.0s')
  })
})
