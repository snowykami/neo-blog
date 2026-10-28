import type { LyricWord } from './types'
import { describe, expect, it } from 'vitest'
import { alignRomanization, romanWordsFromTimed } from './romanization'

/** 每个字一个音节，依次 500ms */
function syllables(text: string): LyricWord[] {
  return [...text].map((char, i) => ({ text: char, start: i * 500, end: i * 500 + 500 }))
}

/** 每个音节显示的音译（按音节拼接） */
function byWord(words: LyricWord[], romanization: string) {
  const aligned = alignRomanization(romanization, words)
  if (!aligned)
    return null
  return words.map((_, i) => aligned.filter(part => part.word === i).map(part => part.text).join(''))
}

describe('逐字音译', () => {
  it('日文：假名作为锚点，汉字分到其间的音拍；助词は读作 wa，长音并入前一个音节', () => {
    expect(byWord(syllables('初めてのルーブルは'), 'hajimete no ruuburu wa')).toEqual(['haji', 'me', 'te ', 'no ', 'ruu', '', 'bu', 'ru ', 'wa'])
  })

  it('日文：促音的辅音、拗音的小假名', () => {
    // 促音的辅音并入前一个音节（同 StarryPlayer）
    expect(byWord(syllables('きっと'), 'kitto')).toEqual(['kit', '', 'to'])
    expect(byWord(syllables('きゃく'), 'kyaku')).toEqual(['kya', '', 'ku'])
  })

  it('日文：多个汉字按音拍平均分配，音拍不够时对不齐', () => {
    expect(byWord(syllables('私だけ'), 'watashi dake')).toEqual(['watashi ', 'da', 'ke'])
    expect(byWord(syllables('出会って'), 'deatte')).toEqual(['de', 'at', '', 'te'])
    expect(alignRomanization('a ke', syllables('出会け'))).toBeNull()
  })

  it('音译与原文对不上时不对齐（宁缺勿错）', () => {
    expect(alignRomanization('sayonara', syllables('初めての'))).toBeNull()
  })

  it('纯汉字行：音译词与字一一配对（拼音），数量对不上时不对齐', () => {
    expect(byWord(syllables('故事的小黄花'), 'gù shì de xiǎo huáng huā')).toEqual(['gù ', 'shì ', 'de ', 'xiǎo ', 'huáng ', 'huā'])
    expect(alignRomanization('gushi de xiao huanghua', syllables('故事的小黄花'))).toBeNull()
  })

  it('纯拉丁文字与韩文不对齐', () => {
    expect(alignRomanization('hello', [{ text: 'hello', start: 0, end: 500 }])).toBeNull()
    expect(alignRomanization('sa rang', syllables('사랑'))).toBeNull()
  })

  it('来源自带逐字时间的音译按开始时间归到原文音节', () => {
    const words = [{ text: '初', start: 20699, end: 21133 }, { text: 'め', start: 21133, end: 21302 }]
    const parts = romanWordsFromTimed([{ text: 'ha ', startTime: 20699, duration: 19 }, { text: 'ji ', startTime: 20718, duration: 415 }, { text: 'me ', startTime: 21133, duration: 169 }], words)
    expect(parts?.map(part => [part.text, part.word])).toEqual([['ha ', 0], ['ji ', 0], ['me ', 1]])
  })
})
