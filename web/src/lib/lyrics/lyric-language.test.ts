import type { ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import {
  applyDualLanguageTranslations,
  applyLanguageTranslations,
  canAdminAiTranslateLyrics,
  canAiTranslateLyrics,
  classifyVocalLine,
  detectLyricTextLang,
  hasNativeTargetTranslation,
  normalizeLyricLangTag,
  songAlreadyInTargetLang,
  toggleLyricTranslationSelection,
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
    expect(classifyVocalLine('李荣浩：')).toBeNull()
    expect(classifyVocalLine('女：')).toBeNull()
    expect(classifyVocalLine('[Chorus]')).toBeNull()
    expect(classifyVocalLine('李荣浩：如果有一天我回到从前')).toBe('李荣浩：如果有一天我回到从前')
    expect(classifyVocalLine('汪：我是米开朗基罗')).toBe('汪：我是米开朗基罗')

    expect(songAlreadyInTargetLang(['BY2：是你让我的世界从那刻变成粉红色', '汪：我是米开朗基罗'], 'zh')).toBe(true)
    expect(songAlreadyInTargetLang(['BY2：You turned my world into pink', '汪：I am the one with you'], 'en')).toBe(true)
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

    // 拉丁字母造语（含偶发单字母词）不被误判为英文，在英文界面仍需触发 AI 参考译文翻译
    const conlangLines = ['LaVI-Bavellabion', 'A kalima sora no mi', 'Feli vanna doris']
    expect(detectLyricTextLang(conlangLines)).toBe('other')
    const conlangLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: conlangLines.map((text, idx) => ({
        words: [{ text, start: idx * 3000 + 1000, end: (idx + 1) * 3000 }],
        start: idx * 3000 + 1000,
        end: (idx + 1) * 3000,
        isDuet: false,
        isBackground: false,
      })),
    }
    expect(canAiTranslateLyrics(conlangLyrics, 'en')).toBe(true)
  })

  it('ai 翻译可以覆盖原生内嵌翻译（LRC 与 TTML），且仅管理员能力判定允许触发同源已有内置译文的语种', () => {
    const japaneseWithNativeZh: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        {
          words: [{ text: '君の名前を呼んでいる', start: 1000, end: 3000 }],
          start: 1000,
          end: 3000,
          translation: '原生中文译文1',
          isDuet: false,
          isBackground: false,
        },
        {
          words: [{ text: '夜明けの空が染まるまで', start: 3000, end: 5000 }],
          start: 3000,
          end: 5000,
          translation: '原生中文译文2',
          isDuet: false,
          isBackground: false,
        },
      ],
    }

    expect(hasNativeTargetTranslation(japaneseWithNativeZh, 'zh')).toBe(true)
    expect(canAiTranslateLyrics(japaneseWithNativeZh, 'zh')).toBe(false)
    expect(canAdminAiTranslateLyrics(japaneseWithNativeZh, 'zh')).toBe(true)
    expect(canAdminAiTranslateLyrics(japaneseWithNativeZh, 'ja')).toBe(false)

    // AI 生成的新中文翻译覆盖原有内置中文翻译
    const overridden = applyLanguageTranslations(japaneseWithNativeZh, 'zh', {
      source: 'ncm-lrc',
      targetLang: 'zh',
      native: false,
      lines: [
        { text: '君の名前を呼んでいる', occurrence: 0, translation: 'AI 精译：呼唤着你的名字' },
        { text: '夜明けの空が染まるまで', occurrence: 0, translation: 'AI 精译：直至破晓染红天际' },
      ],
    })
    expect(overridden.lines[0].translation).toBe('AI 精译：呼唤着你的名字')
    expect(overridden.lines[1].translation).toBe('AI 精译：直至破晓染红天际')

    // 若 AI 流式尚未就绪或部分行为空字符串，保留已有原生译文不闪烁清空
    const partialOverride = applyLanguageTranslations(japaneseWithNativeZh, 'zh', {
      source: 'ncm-lrc',
      targetLang: 'zh',
      native: false,
      lines: [
        { text: '君の名前を呼んでいる', occurrence: 0, translation: 'AI 精译：呼唤着你的名字' },
        { text: '夜明けの空が染まるまで', occurrence: 0, translation: '' },
      ],
    })
    expect(partialOverride.lines[0].translation).toBe('AI 精译：呼唤着你的名字')
    expect(partialOverride.lines[1].translation).toBe('原生中文译文2')

    // TTML 多语言翻译容器同理可被 AI 覆盖，未到达行回退到同语种原生译文
    const ttml = parseTtml(`<tt xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body><div><p begin="00:01.00" end="00:03.00" itunes:key="L1"><span>君の名前</span></p><p begin="00:03.00" end="00:05.00" itunes:key="L2"><span>夜明けの空</span></p></div></body><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="zh-CN"><text for="L1">内置TTML1</text><text for="L2">内置TTML2</text></translation></translations></iTunesMetadata></metadata></tt>`, 'ttml-amll')
    expect(ttml).not.toBeNull()
    if (!ttml)
      return
    const ttmlOverridden = applyLanguageTranslations(ttml, 'zh', {
      source: ttml.source,
      targetLang: 'zh',
      native: false,
      lines: [
        { text: '君の名前', occurrence: 0, translation: 'TTML AI 覆盖1' },
      ],
    })
    expect(ttmlOverridden.lines[0].translation).toBe('TTML AI 覆盖1')
    expect(ttmlOverridden.lines[1].translation).toBe('内置TTML2')

    // preferNative 为 true 且当前歌含同语种原生译文时，可无损切换回原生内置译文（LRC 与 TTML 均支持）
    const lrcAiSet = {
      source: 'ncm-lrc' as const,
      targetLang: 'zh' as const,
      native: false,
      lines: [
        { text: '君の名前を呼んでいる', occurrence: 0, translation: 'AI 精译：呼唤着你的名字' },
        { text: '夜明けの空が染まるまで', occurrence: 0, translation: 'AI 精译：直至破晓染红天际' },
      ],
    }
    const backToLrcNative = applyLanguageTranslations(japaneseWithNativeZh, 'zh', lrcAiSet, true)
    expect(backToLrcNative.lines[0].translation).toBe('原生中文译文1')
    expect(backToLrcNative.lines[1].translation).toBe('原生中文译文2')

    const ttmlAiFull = {
      source: ttml.source,
      targetLang: 'zh' as const,
      native: false,
      lines: [
        { text: '君の名前', occurrence: 0, translation: 'TTML AI 覆盖1' },
        { text: '夜明けの空', occurrence: 0, translation: 'TTML AI 覆盖2' },
      ],
    }
    expect(applyLanguageTranslations(ttml, 'zh', ttmlAiFull, false).lines[0].translation).toBe('TTML AI 覆盖1')
    const backToTtmlNative = applyLanguageTranslations(ttml, 'zh', ttmlAiFull, true)
    expect(backToTtmlNative.lines[0].translation).toBe('内置TTML1')
    expect(backToTtmlNative.lines[1].translation).toBe('内置TTML2')

    // 若切到没有原生内置译文的曲目，即使 preferNative 为 true 仍安全回退展示 AI 译文，不留白
    const noNativeJapanese: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '君の名前を呼んでいる', start: 1000, end: 3000 }], start: 1000, end: 3000, isDuet: false, isBackground: false },
        { words: [{ text: '夜明けの空が染まるまで', start: 3000, end: 5000 }], start: 3000, end: 5000, isDuet: false, isBackground: false },
      ],
    }
    const fallbackAi = applyLanguageTranslations(noNativeJapanese, 'zh', lrcAiSet, true)
    expect(fallbackAi.lines[0].translation).toBe('AI 精译：呼唤着你的名字')
    expect(fallbackAi.lines[1].translation).toBe('AI 精译：直至破晓染红天际')
  })

  it('支持最多勾选两项译文来源并按勾选顺序上下对比（同语种 AI+内置 与 跨语种）', () => {
    // 1. 勾选切换纯函数：单选 -> 双选保序 -> 取消后重选翻转顺序 -> 超过 2 项淘汰最早项 -> 全消为空
    let selections = toggleLyricTranslationSelection([], { lang: 'zh', preferNative: false }, { hasDualSources: true })
    expect(selections).toEqual([{ lang: 'zh', preferNative: false }])

    selections = toggleLyricTranslationSelection(selections, { lang: 'zh', preferNative: true }, { hasDualSources: true })
    expect(selections).toEqual([
      { lang: 'zh', preferNative: false },
      { lang: 'zh', preferNative: true },
    ])

    // 取消第 1 项后再重选，顺序翻转为 [内置, AI]
    selections = toggleLyricTranslationSelection(selections, { lang: 'zh', preferNative: false }, { hasDualSources: true })
    expect(selections).toEqual([{ lang: 'zh', preferNative: true }])
    selections = toggleLyricTranslationSelection(selections, { lang: 'zh', preferNative: false }, { hasDualSources: true })
    expect(selections).toEqual([
      { lang: 'zh', preferNative: true },
      { lang: 'zh', preferNative: false },
    ])

    // 再勾选第 3 项（单来源 en）时仅保留最近 2 项
    selections = toggleLyricTranslationSelection(selections, { lang: 'en' }, { hasDualSources: false })
    expect(selections).toEqual([
      { lang: 'zh', preferNative: false },
      { lang: 'en', preferNative: false },
    ])

    // 全部取消回归空数组
    selections = toggleLyricTranslationSelection(selections, { lang: 'zh', preferNative: false }, { hasDualSources: true })
    selections = toggleLyricTranslationSelection(selections, { lang: 'en' }, { hasDualSources: false })
    expect(selections).toEqual([])

    // 2. 同语种 AI 简体与内置简体双轨合成（上下顺序随勾选顺序翻转）
    const lrcDual: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '君の名前を呼んでいる', start: 1000, end: 3000 }], start: 1000, end: 3000, translation: '原生中文1', isDuet: false, isBackground: false },
        { words: [{ text: '夜明けの空が染まるまで', start: 3000, end: 5000 }], start: 3000, end: 5000, translation: '原生中文2', isDuet: false, isBackground: false },
      ],
    }
    const aiZhFull = {
      source: 'ncm-lrc',
      targetLang: 'zh',
      native: false,
      lines: [
        { text: '君の名前を呼んでいる', occurrence: 0, translation: 'AI 中文1' },
        { text: '夜明けの空が染まるまで', occurrence: 0, translation: 'AI 中文2' },
      ],
    }

    const aiTopNativeBottom = applyDualLanguageTranslations(
      lrcDual,
      { lang: 'zh', preferNative: false, ai: aiZhFull },
      { lang: 'zh', preferNative: true, ai: null },
    )
    expect(aiTopNativeBottom.lines.map(l => [l.translation, l.secondaryTranslation])).toEqual([
      ['AI 中文1', '原生中文1'],
      ['AI 中文2', '原生中文2'],
    ])

    const nativeTopAiBottom = applyDualLanguageTranslations(
      lrcDual,
      { lang: 'zh', preferNative: true, ai: null },
      { lang: 'zh', preferNative: false, ai: aiZhFull },
    )
    expect(nativeTopAiBottom.lines.map(l => [l.translation, l.secondaryTranslation])).toEqual([
      ['原生中文1', 'AI 中文1'],
      ['原生中文2', 'AI 中文2'],
    ])

    // 流式尚未到达第 2 句时，AI 轨在同语种对比下不回退显示原生中文，避免上下两行显示同一句话
    const aiZhPartial = {
      source: 'ncm-lrc',
      targetLang: 'zh',
      native: false,
      lines: [{ text: '君の名前を呼んでいる', occurrence: 0, translation: 'AI 中文1' }],
    }
    const partialCompare = applyDualLanguageTranslations(
      lrcDual,
      { lang: 'zh', preferNative: false, ai: aiZhPartial },
      { lang: 'zh', preferNative: true, ai: null },
    )
    expect(partialCompare.lines[0].translation).toBe('AI 中文1')
    expect(partialCompare.lines[0].secondaryTranslation).toBe('原生中文1')
    expect(partialCompare.lines[1].translation).toBeUndefined()
    expect(partialCompare.lines[1].secondaryTranslation).toBe('原生中文2')

    // 3. 跨语种对比：[en (AI), zh (原生)]
    const aiEnSet = {
      source: 'ncm-lrc',
      targetLang: 'en',
      native: false,
      lines: [
        { text: '君の名前を呼んでいる', occurrence: 0, translation: 'Calling your name' },
        { text: '夜明けの空が染まるまで', occurrence: 0, translation: 'Until the dawn sky blushes' },
      ],
    }
    const crossLang = applyDualLanguageTranslations(
      lrcDual,
      { lang: 'en', preferNative: false, ai: aiEnSet },
      { lang: 'zh', preferNative: false, ai: null },
    )
    expect(crossLang.lines.map(l => [l.translation, l.secondaryTranslation])).toEqual([
      ['Calling your name', '原生中文1'],
      ['Until the dawn sky blushes', '原生中文2'],
    ])
  })

  it('摩斯电码等抽象符号行可触发 AI 覆盖且按原信号区分匹配不碰撞，普通省略号与分隔线保持跳过', () => {
    expect(songAlreadyInTargetLang(['...', '---', '//'], 'zh')).toBe(true)
    expect(songAlreadyInTargetLang(['... --- ...', '.- / -...'], 'zh')).toBe(false)

    const morseLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '... --- ...', start: 1000, end: 3000 }], start: 1000, end: 3000, translation: '求救信号', isDuet: false, isBackground: false },
        { words: [{ text: '.- / -...', start: 4000, end: 6000 }], start: 4000, end: 6000, translation: '暗码启程', isDuet: false, isBackground: false },
        { words: [{ text: '...', start: 7000, end: 8000 }], start: 7000, end: 8000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAdminAiTranslateLyrics(morseLyrics, 'zh')).toBe(true)

    const dividerOnlyLyrics: ResolvedLyrics = {
      source: 'ncm-lrc',
      wordTimed: false,
      instrumental: false,
      lines: [
        { words: [{ text: '...', start: 1000, end: 2000 }], start: 1000, end: 2000, isDuet: false, isBackground: false },
        { words: [{ text: '---', start: 3000, end: 4000 }], start: 3000, end: 4000, isDuet: false, isBackground: false },
      ],
    }
    expect(canAdminAiTranslateLyrics(dividerOnlyLyrics, 'zh')).toBe(false)

    const aiMorse = {
      source: 'ncm-lrc',
      targetLang: 'zh',
      native: false,
      lines: [
        { text: '... --- ...', occurrence: 0, translation: '发往星海的求救电波' },
        { text: '.- / -...', occurrence: 0, translation: '破译暗码启程远航' },
      ],
    }
    const merged = applyLanguageTranslations(morseLyrics, 'zh', aiMorse)
    expect(merged.lines.map(l => l.translation)).toEqual([
      '发往星海的求救电波',
      '破译暗码启程远航',
      undefined,
    ])

    const compared = applyDualLanguageTranslations(
      morseLyrics,
      { lang: 'zh', preferNative: false, ai: aiMorse },
      { lang: 'zh', preferNative: true, ai: null },
    )
    expect(compared.lines.slice(0, 2).map(l => [l.translation, l.secondaryTranslation])).toEqual([
      ['发往星海的求救电波', '求救信号'],
      ['破译暗码启程远航', '暗码启程'],
    ])
  })
})
