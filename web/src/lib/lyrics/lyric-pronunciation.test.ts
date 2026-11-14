import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { applyLyricSingers, canResolveLyricSingers } from './apply-singers'
import {
  applyPronunciationsAndFilter,
  buildRomanWordsFromAiTokens,
  canAiPronounceLyrics,
  extractPronounceableWordIndices,
  shouldHideSameLangPronunciation,
} from './lyric-pronunciation'
import { parseTtml } from './parse-ttml'
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
    expect(formatTitleAliases('让风告诉你', ['游戏《原神》2021拜年纪同人曲'], 'Let the Wind Tell You', true, ['Genshin Impact 2021 New Year Fan Song'])).toBe('Let the Wind Tell You, Genshin Impact 2021 New Year Fan Song')
    expect(formatInlineSongTitle('紫荆花盛开', ['香港回归25周年主题曲'], 'Bauhinia in Full Bloom', true, ['Theme Song for the 25th Anniversary of Hong Kong\'s Return'])).toBe('紫荆花盛开 (Bauhinia in Full Bloom, Theme Song for the 25th Anniversary of Hong Kong\'s Return)')
    expect(formatTitleAliases('让风告诉你', ['游戏《原神》2021拜年纪同人曲'], 'Let the Wind Tell You', false, ['Genshin Impact 2021 New Year Fan Song'])).toBe('游戏《原神》2021拜年纪同人曲')
    expect(formatDisplayArtists(['米津玄師', 'DAOKO'], ['米津玄师', 'DAOKO'], true)).toEqual(['米津玄師 (米津玄师)', 'DAOKO'])
    expect(formatDisplayArtists(['米津玄師'], ['米津玄师'], false)).toEqual(['米津玄師'])
  })

  it('tTML 显式声部对齐与 x-bg 对齐不被后端翻转且保留注音空格与闽南语显示', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttd="http://www.example.com/ttd">
<head><metadata>
  <ttm:agent xml:id="v1" type="person"><ttm:name>筱白白</ttm:name></ttm:agent>
  <ttm:agent xml:id="v2" type="other"><ttm:name>念白</ttm:name></ttm:agent>
</metadata></head>
<body><div>
  <p begin="00:01.000" end="00:03.000" ttm:agent="v2">天干物燥</p>
  <p begin="00:04.000" end="00:07.000" ttm:agent="v1">明月爬阁楼<span ttm:role="x-bg" ttm:agent="v2" ttd:position="right">(小心嗯哼)</span></p>
</div></body></tt>`

    const parsed = parseTtml(ttml, 'ttml-amll')
    expect(parsed).not.toBeNull()
    const merged = applyLyricSingers(parsed!, {
      status: 'ready',
      source: 'ttml-amll',
      singers: [
        { id: 'v2', name: '念白', role: 'person', align: 'left' },
        { id: 'v1', name: '筱白白', role: 'person', align: 'right' },
      ],
      translatedNames: { v1: 'Xiao Baibai', v2: 'Narrator' },
      lines: [
        { text: '天干物燥', occurrence: 0, bg: false, agent: 'v2' },
        { text: '明月爬阁楼', occurrence: 0, bg: false, agent: 'v1' },
        { text: '(小心嗯哼)', occurrence: 0, bg: true, agent: 'v2' },
      ],
    }, true)

    expect(merged.lines[0]).toMatchObject({ align: 'right', isDuet: true, agent: 'v2' })
    expect(merged.lines[1]).toMatchObject({ align: 'left', isDuet: false, agent: 'v1' })
    expect(merged.lines[2]).toMatchObject({ align: 'right', isDuet: true, isBackground: true, agent: 'v2' })
    expect(merged.agents?.v1?.name).toBe('筱白白 (Xiao Baibai)')
    expect(merged.agents?.v2?.name).toBe('念白 (Narrator)')

    const zhTwWords = [
      { text: '朋', start: 1000, end: 1500 },
      { text: '友', start: 1500, end: 2000 },
      { text: '们', start: 2000, end: 2500 },
    ]
    const zhTwSpanFallback = buildRomanWordsFromAiTokens(zhTwWords, undefined, 'ㄆㄥˊ ㄧㄡˇ ˙ㄇㄣ')
    expect(zhTwSpanFallback?.map(item => item.text)).toEqual(['ㄆㄥˊ ', 'ㄧㄡˇ ', '˙ㄇㄣ'])

    const hokkienLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '毋知影是啥物滋味 袂记咧', start: 1000, end: 4000 }], start: 1000, end: 4000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAiPronounceLyrics(hokkienLyrics, 'zh')).toBe(true)
    expect(canAiPronounceLyrics(hokkienLyrics, 'zh-tw')).toBe(true)
    const hokkienPron = {
      status: 'ready' as const,
      source: 'ncm-lrc',
      lang: 'other',
      lines: [
        { text: '毋知影是啥物滋味 袂记咧', occurrence: 0, bg: false, lang: 'other', pronunciation: 'm̄ tsai-iánn sī siánn-mih tsu-bī buē-kì-leh' },
      ],
    }
    expect(applyPronunciationsAndFilter(hokkienLyrics, 'zh', hokkienPron).lines[0].romanization).toBe('m̄ tsai-iánn sī siánn-mih tsu-bī buē-kì-leh')
    expect(applyPronunciationsAndFilter(hokkienLyrics, 'zh-tw', hokkienPron).lines[0].romanization).toBe('m̄ tsai-iánn sī siánn-mih tsu-bī buē-kì-leh')
  })

  it('只要存在非器乐且非空的已解析歌词行即允许请求声部归属查询，不在前端用硬编码规则拦截', () => {
    const soloPlainLyrics: ResolvedLyrics = {
      source: 'qq-qrc',
      wordTimed: true,
      instrumental: false,
      lines: [
        { words: [{ text: '窗外的麻雀', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
      ],
    }
    expect(canResolveLyricSingers(soloPlainLyrics)).toBe(true)

    const youdiantianLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '合：眼神坚定着我们的选择', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: 'BY2：是你让我的世界从那刻变成粉红色', start: 4000, end: 6000 }], start: 4000, end: 6000, isDuet: false, isBackground: false },
        { words: [{ text: '汪：我是米开朗基罗', start: 7000, end: 9000 }], start: 7000, end: 9000, isDuet: false, isBackground: false },
      ],
    }
    expect(canResolveLyricSingers(youdiantianLyrics)).toBe(true)

    const singleUnnamedTtml: ResolvedLyrics = {
      source: 'ttml-amll',
      wordTimed: false,
      instrumental: false,
      agents: {
        v1: { id: 'v1', color: 'sky' },
      },
      lines: [
        { words: [{ text: '天干物燥', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false, agent: 'v1' },
      ],
    }
    expect(canResolveLyricSingers(singleUnnamedTtml)).toBe(true)

    const instrumentalLyrics: ResolvedLyrics = {
      ...soloPlainLyrics,
      instrumental: true,
    }
    expect(canResolveLyricSingers(instrumentalLyrics)).toBe(false)

    const emptyLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [],
    }
    expect(canResolveLyricSingers(emptyLyrics)).toBe(false)

    const noneLyrics: ResolvedLyrics = {
      source: 'none',
      wordTimed: false,
      instrumental: false,
      lines: soloPlainLyrics.lines,
    }
    expect(canResolveLyricSingers(noneLyrics)).toBe(false)
  })
})
