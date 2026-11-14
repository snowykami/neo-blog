import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import {
  applyLanguageTranslations,
  canAiTranslateLyrics,
  classifyVocalLine,
  detectLyricTextLang,
  hasNativeTargetTranslation,
  normalizeLyricLangTag,
  songAlreadyInTargetLang,
  toLyricTargetLang,
} from './lyric-language'
import { parseTtml } from './parse-ttml'

describe('歌词语言检测与多语种翻译匹配', () => {
  it('语言标签与简繁识别', () => {
    expect(toLyricTargetLang('zh-CN')).toBe('zh')
    expect(toLyricTargetLang('zh-TW')).toBe('zh-tw')
    expect(toLyricTargetLang('zh-HK')).toBe('zh-hk')
    expect(toLyricTargetLang('zh-MO')).toBe('zh-hk')
    expect(toLyricTargetLang('en-US')).toBe('en')
    expect(toLyricTargetLang('ja')).toBe('ja')
    expect(toLyricTargetLang('ko')).toBe('ko')

    expect(normalizeLyricLangTag('zh-Hant')).toBe('zh-tw')
    expect(normalizeLyricLangTag('zh-Hant-TW')).toBe('zh-tw')
    expect(normalizeLyricLangTag('zh-Hant-HK')).toBe('zh-hk')
    expect(normalizeLyricLangTag('ja-Latn')).toBeNull()

    expect(detectLyricTextLang(['今天天氣真好，我們一起出發吧', '這是一段繁體中文測試'], 'zh')).toBe('zh-tw')
    expect(detectLyricTextLang(['Hello world, I know you are there', 'When the night falls on the sky'], 'zh')).toBe('en')
    expect(detectLyricTextLang(['君の名前を呼んでいる'])).toBe('ja')
    expect(detectLyricTextLang(['사랑해 너를 기억해'])).toBe('ko')
  })

  it('非唱词过滤与双语混唱判断', () => {
    expect(classifyVocalLine('李荣浩：', ['李荣浩'])).toBeNull()
    expect(classifyVocalLine('女：', ['张三'])).toBeNull()
    expect(classifyVocalLine('[Chorus]', ['张三'])).toBeNull()
    expect(classifyVocalLine('李荣浩：如果有一天我回到从前', ['李荣浩'])).toBe('如果有一天我回到从前')
    expect(classifyVocalLine('花玲：烦恼都走开', ['可莉 (花玲)'])).toBe('烦恼都走开')

    expect(songAlreadyInTargetLang(['Oh yeah', '君の名前を呼ぶ', '夜空に星が流れる'], 'ja')).toBe(true)
    expect(songAlreadyInTargetLang(['君の名前を呼ぶ', 'Underneath the moonlight tonight', 'Hold me closer till morning light'], 'ja')).toBe(false)
    expect(songAlreadyInTargetLang(['君の名前を呼ぶ', 'Underneath the moonlight tonight', 'Hold me closer till morning light'], 'zh')).toBe(false)
  })

  it('tTML 多语种解析与按语言切换译文', () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
<head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
<translations>
  <translation xml:lang="zh-Hans"><text for="L1">第一句<span ttm:role="x-bg">（和声）</span></text><text for="L2">第二句</text></translation>
  <translation xml:lang="en-US"><text for="L1">First line<span ttm:role="x-bg">(bg)</span></text><text for="L2">Second line</text></translation>
</translations>
</iTunesMetadata></metadata></head>
<body><div>
<p begin="00:01.000" end="00:04.000" itunes:key="L1"><span begin="00:01.500" end="00:03.000">君の名は</span><span ttm:role="x-bg"><span begin="00:01.000" end="00:01.400">(ooh)</span></span></p>
<p begin="00:05.000" end="00:08.000" itunes:key="L2"><span begin="00:05.000" end="00:08.000">君の名は</span></p>
</div></body></tt>`

    const parsed = parseTtml(ttml, 'ttml-amll')!
    expect(hasNativeTargetTranslation(parsed, 'zh')).toBe(true)
    expect(hasNativeTargetTranslation(parsed, 'en')).toBe(true)
    expect(hasNativeTargetTranslation(parsed, 'zh-tw')).toBe(false)
    expect(hasNativeTargetTranslation(parsed, 'ko')).toBe(false)
    expect(canAiTranslateLyrics(parsed, 'zh')).toBe(false)
    expect(canAiTranslateLyrics(parsed, 'zh-tw')).toBe(true)
    expect(canAiTranslateLyrics(parsed, 'ko')).toBe(true)

    const enApplied = applyLanguageTranslations(parsed, 'en', null)
    expect(enApplied.lines.find(l => !l.isBackground && l.start < 4000)?.translation).toBe('First line')
    expect(enApplied.lines.find(l => l.isBackground)?.translation).toBe('(bg)')

    // 未就绪的目标语言（ko）不应错误显示简体中文内置翻译
    const koPending = applyLanguageTranslations(parsed, 'ko', null)
    expect(koPending.lines.every(l => l.translation === undefined)).toBe(true)

    // AI 翻译按 (isBackground, occurrence, normalizeForMatch(text)) 对齐重复行与背景行
    const koApplied = applyLanguageTranslations(parsed, 'ko', {
      source: 'ttml-amll',
      targetLang: 'ko',
      lines: [
        { text: '(ooh)', occurrence: 0, bg: true, translation: '(우)' },
        { text: '君の名は', occurrence: 0, bg: false, translation: '너의 이름은' },
        { text: '君の名は', occurrence: 1, bg: false, translation: '그대의 이름은' },
      ],
    })
    const mains = koApplied.lines.filter(l => !l.isBackground)
    const bgs = koApplied.lines.filter(l => l.isBackground)
    expect(bgs[0].translation).toBe('(우)')
    expect(mains[0].translation).toBe('너의 이름은')
    expect(mains[1].translation).toBe('그대의 이름은')
  })

  it('繁体中文不直接沿用简体内置译文且支持重新映射', () => {
    const simplifiedLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: 'I miss you every night', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false, translation: '每天夜晚我都好想你' },
        { words: [{ text: 'Under the rain', start: 4000, end: 6000 }], start: 4000, end: 6000, isDuet: false, isBackground: false, translation: '在这场雨中徘徊' },
      ],
    }
    expect(hasNativeTargetTranslation(simplifiedLyrics, 'zh')).toBe(true)
    expect(hasNativeTargetTranslation(simplifiedLyrics, 'zh-tw')).toBe(false)
    expect(canAiTranslateLyrics(simplifiedLyrics, 'zh-tw')).toBe(true)

    // 双语中 AI 未返回的空翻译行保持 undefined，不残留原简体字幕
    const partialTw = applyLanguageTranslations(simplifiedLyrics, 'zh-tw', {
      source: 'ncm-lrc',
      targetLang: 'zh-tw',
      lines: [{ text: 'Under the rain', occurrence: 0, translation: '在這場雨中徘徊' }],
    })
    expect(partialTw.lines[0].translation).toBeUndefined()
    expect(partialTw.lines[1].translation).toBe('在這場雨中徘徊')

    expect(hasNativeTargetTranslation(simplifiedLyrics, 'zh-hk')).toBe(false)
    expect(canAiTranslateLyrics(simplifiedLyrics, 'zh-hk')).toBe(true)
  })

  it('中日语混合加英文拟声词检测', () => {
    expect(songAlreadyInTargetLang([
      'Pico bala-ba-ba-ba',
      'Bibo bala-ba-ba-ba',
      'Dido bala-ba-ba-ba',
      'Nino na-ra-na-na-na',
      '叮咚 叮叮咚咚',
      '收到总部命令',
    ], 'zh')).toBe(true)

    expect(songAlreadyInTargetLang([
      '人は猫dala-da-da-da',
      'Pico bala-ba-ba-ba',
      '絶対にそう ny-ny-nya-nya-nya',
      '叮咚 叮叮咚咚',
      '收到总部命令',
    ], 'zh')).toBe(false)

    expect(songAlreadyInTargetLang([
      '今晚的夜色真温柔',
      'No I love you',
    ], 'zh')).toBe(false)
  })

  it('错标 xml:lang 交叉校验与古文 / 古风识别', () => {
    expect(detectLyricTextLang(['今晚的夜色真温柔', '我想牵着你的手'], 'ja')).toBe('zh')
    expect(detectLyricTextLang(['今夜の風がとても優しい', '君の手を繋いで'], 'zh')).toBe('ja')

    const classicalLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '浔阳江头夜送客', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: '枫叶荻花秋瑟瑟', start: 3000, end: 5000 }], start: 3000, end: 5000, isDuet: false, isBackground: false },
        { words: [{ text: '主人下马客在船', start: 5000, end: 7000 }], start: 5000, end: 7000, isDuet: false, isBackground: false },
        { words: [{ text: '忽闻水上琵琶声', start: 7000, end: 9000 }], start: 7000, end: 9000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAiTranslateLyrics(classicalLyrics, 'zh')).toBe(true)

    const gufengLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '恰似故人踏月归来', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: '与君共饮此杯中酒', start: 3000, end: 5000 }], start: 3000, end: 5000, isDuet: false, isBackground: false },
        { words: [{ text: '我们一起笑着奔向明天', start: 5000, end: 7000 }], start: 5000, end: 7000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAiTranslateLyrics(gufengLyrics, 'zh')).toBe(true)

    const modernMandarin: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '我好想你', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: '你在我身边', start: 3000, end: 5000 }], start: 3000, end: 5000, isDuet: false, isBackground: false },
        { words: [{ text: '风吹过窗台', start: 5000, end: 7000 }], start: 5000, end: 7000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAiTranslateLyrics(modernMandarin, 'zh')).toBe(false)
  })
})
