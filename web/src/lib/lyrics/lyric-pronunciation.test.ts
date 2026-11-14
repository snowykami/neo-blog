import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { applyLyricSingers } from './apply-singers'
import {
  applyPronunciationsAndFilter,
  buildRomanWordsFromAiTokens,
  canAiPronounceLyrics,
  extractPronounceableWordIndices,
  shouldHideSameLangPronunciation,
} from './lyric-pronunciation'
import { formatDisplayArtists, formatInlineSongTitle, formatTitleAliases } from './song-meta-format'

describe('aI 歌词读音对齐与同语言显隐', () => {
  it('可发音词元索引提取与逐字 1-to-1 / span 回退对齐', () => {
    const words = [
      { text: '朋友', start: 1000, end: 2000 },
      { text: '、', start: 2000, end: 2100 },
      { text: '再见！', start: 2100, end: 3000 },
    ]
    expect(extractPronounceableWordIndices(words)).toEqual([0, 2])

    const direct = buildRomanWordsFromAiTokens(words, ['ㄆㄥˊ ㄧㄡˇ', '˙ㄇㄣ'])
    expect(direct).toEqual([
      { text: 'ㄆㄥˊ ㄧㄡˇ ', start: 1000, end: 2000, word: 0 },
      { text: '˙ㄇㄣ', start: 2100, end: 3000, word: 2 },
    ])

    // 当未返回 tokens 但汉字总字数与空格分隔拼音音节数一致时，拆分为 span 并绑定对应 word
    const hanWords = [
      { text: '长江', start: 1000, end: 2000 },
      { text: '水', start: 2000, end: 2500 },
    ]
    const spanFallback = buildRomanWordsFromAiTokens(hanWords, undefined, 'cháng jiāng shuǐ')
    expect(spanFallback?.map(item => [item.text.trim(), item.word])).toEqual([
      ['cháng', 0],
      ['jiāng', 0],
      ['shuǐ', 1],
    ])
  })

  it('同语言读音自动隐藏与混合语种保留规则', () => {
    expect(shouldHideSameLangPronunciation('zh', 'zh')).toBe(true)
    expect(shouldHideSameLangPronunciation('zh-tw', 'zh')).toBe(true)
    expect(shouldHideSameLangPronunciation('zh', 'zh-tw')).toBe(true)
    expect(shouldHideSameLangPronunciation('zh-hk', 'zh')).toBe(false)
    expect(shouldHideSameLangPronunciation('zh-hk', 'zh-hk')).toBe(true)
    expect(shouldHideSameLangPronunciation('zh', 'zh-hk')).toBe(false)
    expect(shouldHideSameLangPronunciation('en', 'en')).toBe(true)
    expect(shouldHideSameLangPronunciation('en', 'zh')).toBe(false)
    // 日韩与小语种无论在何种界面语言下都不隐藏
    expect(shouldHideSameLangPronunciation('ja', 'ja')).toBe(false)
    expect(shouldHideSameLangPronunciation('ko', 'ko')).toBe(false)
    expect(shouldHideSameLangPronunciation('other', 'en')).toBe(false)
  })

  it('保留原生自带读音并仅补全缺失行，同时按界面语言过滤', () => {
    const lyrics: ResolvedLyrics = {
      source: 'ncm-yrc',
      wordTimed: true,
      instrumental: false,
      lines: [
        {
          words: [{ text: '唔该你', start: 1000, end: 2000 }],
          start: 1000,
          end: 2000,
          isDuet: false,
          isBackground: false,
          romanization: 'm4 goi1 nei5',
        },
        {
          words: [
            { text: '我', start: 3000, end: 3500 },
            { text: '们', start: 3500, end: 4000 },
          ],
          start: 3000,
          end: 4000,
          isDuet: false,
          isBackground: false,
        },
        {
          words: [{ text: 'ありがとう', start: 5000, end: 6000 }],
          start: 5000,
          end: 6000,
          isDuet: false,
          isBackground: false,
        },
      ],
    }

    const aiData = {
      status: 'ready' as const,
      source: 'ncm-yrc',
      lang: 'zh-hk',
      lines: [
        { text: '我们', occurrence: 0, bg: false, lang: 'zh', pronunciation: 'wǒ men', tokens: ['wǒ', 'men'] },
        { text: 'ありがとう', occurrence: 0, bg: false, lang: 'ja', pronunciation: 'arigatou', tokens: ['arigatou'] },
      ],
    }

    // 简中用户：保留粤语粤拼，隐藏普通话拼音，保留日语罗马音
    const zhView = applyPronunciationsAndFilter(lyrics, 'zh', aiData)
    expect(zhView.lines[0].romanization).toBe('m4 goi1 nei5')
    expect(zhView.lines[1].romanization).toBeUndefined()
    expect(zhView.lines[2].romanization).toBe('arigatou')
    expect(zhView.lines[2].romanizationWords).toEqual([{ text: 'arigatou', start: 5000, end: 6000, word: 0 }])

    // 港繁用户：隐藏粤语粤拼，显示普通话拼音与日语罗马音
    const hkView = applyPronunciationsAndFilter(lyrics, 'zh-hk', aiData)
    expect(hkView.lines[0].romanization).toBeUndefined()
    expect(hkView.lines[1].romanization).toBe('wǒ men')
    expect(hkView.lines[1].romanizationWords).toEqual([
      { text: 'wǒ ', start: 3000, end: 3500, word: 0 },
      { text: 'men', start: 3500, end: 4000, word: 1 },
    ])
    expect(hkView.lines[2].romanization).toBe('arigatou')

    expect(canAiPronounceLyrics({
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '今夜月色很美', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
      ],
    }, 'zh')).toBe(false)
    expect(canAiPronounceLyrics({
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '君の名は', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
      ],
    }, 'ja')).toBe(true)
  })
})

describe('独立演唱者声部与曲名歌手译名格式化', () => {
  it('合成声部颜色、译名及背景行对齐同步', () => {
    const base: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: true,
      instrumental: false,
      agents: {
        v1: { id: 'v1', name: '周杰伦', color: 'sky', colorHex: '#123456' },
      },
      lines: [
        { words: [{ text: '海平面远方', start: 1000, end: 2000 }], start: 1000, end: 2000, isDuet: false, isBackground: false },
        { words: [{ text: '悲伤怎么平息', start: 3000, end: 4000 }], start: 3000, end: 4000, isDuet: false, isBackground: false },
        { words: [{ text: '(和声)', start: 3500, end: 4000 }], start: 3500, end: 4000, isDuet: false, isBackground: true, backgroundPosition: 'below' },
      ],
    }

    const singersData = {
      status: 'ready' as const,
      source: 'ttml-amll',
      singers: [
        { id: 'v1', name: '周杰伦', role: 'person', color: 'ocean', align: 'left' },
        { id: 'v2', name: '梁心颐', role: 'person', color: 'cherry-blossom', align: 'right' },
      ],
      translatedNames: {
        v1: 'Jay Chou',
        v2: 'Lara Veronin',
      },
      lines: [
        { text: '海平面远方', occurrence: 0, bg: false, agent: 'v1' },
        { text: '悲伤怎么平息', occurrence: 0, bg: false, agent: 'v2' },
        { text: '(和声)', occurrence: 0, bg: true, agent: 'v2' },
      ],
    }

    const withTrans = applyLyricSingers(base, singersData, true)
    expect(withTrans.agents?.v1).toMatchObject({ id: 'v1', name: '周杰伦 (Jay Chou)', color: 'sky', colorHex: '#123456' })
    expect(withTrans.agents?.v2).toMatchObject({ id: 'v2', name: '梁心颐 (Lara Veronin)', color: 'cherry-blossom' })
    expect(withTrans.lines[1]).toMatchObject({ agent: 'v2', align: 'right', isDuet: true })
    expect(withTrans.lines[2]).toMatchObject({ agent: 'v2', align: 'right', isDuet: true })

    const withoutTrans = applyLyricSingers(base, singersData, false)
    expect(withoutTrans.agents?.v1.name).toBe('周杰伦')
    expect(withoutTrans.agents?.v2.name).toBe('梁心颐')
  })

  it('曲名与歌手译名拼接去重', () => {
    expect(formatTitleAliases('Lemon', ['柠檬', 'lemon'], '柠檬', true)).toBe('柠檬')
    expect(formatInlineSongTitle('打ち上げ花火', ['打上花火'], '升空焰火', true)).toBe('打ち上げ花火 (升空焰火, 打上花火)')
    expect(formatInlineSongTitle('打ち上げ花火', [], '升空焰火', false)).toBe('打ち上げ花火')
    expect(formatDisplayArtists(['米津玄師', 'DAOKO'], ['米津玄师', 'DAOKO'], true)).toEqual(['米津玄師 (米津玄师)', 'DAOKO'])
    expect(formatDisplayArtists(['米津玄師'], ['米津玄师'], false)).toEqual(['米津玄師'])
  })
})
