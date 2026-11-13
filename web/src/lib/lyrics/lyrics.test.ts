import type { LyricMarqueeWordBox } from './marquee'
import type { LyricLine, LyricWord, ResolvedLyrics } from './types'
import { describe, expect, it } from 'vitest'
import { platformToLyrics } from './from-platform'
import { alignTimedTexts, getLyricLineText } from './line-utils'
import { getLyricMarqueeOffset, LYRIC_MARQUEE_ANCHOR_RATIO, LYRIC_MARQUEE_SMOOTH_WINDOW_MS } from './marquee'
import { parseNcmLyrics, parseQqLyrics } from './parse-platform'
import { preprocessLyricLines } from './preprocess'
import { lyricTier, resolveLyrics } from './resolve'
import { Spring } from './spring'
import { isCreditText, stripCredits } from './strip-credits'
import { buildTimeline, getLineTextAt, getTimelineState, getWordProgress } from './timeline'

function line(start: number, end: number, text = 'x'): LyricLine {
  return {
    words: [{ text, start, end }],
    start,
    end,
    isDuet: false,
    isBackground: false,
  }
}

describe('歌词预处理（8.8）', () => {
  it('归一化空格并去掉空行', () => {
    const [result, ...rest] = preprocessLyricLines([line(1000, 2000, 'a   b'), line(3000, 4000, '   ')])
    expect(result.words[0].text).toBe('a b')
    expect(rest).toEqual([])
  })

  it('清洗无意重叠：不足 100ms 截断，≥ 500ms 保留', () => {
    const trimmed = preprocessLyricLines([line(0, 2050), line(2000, 4000)])
    expect(trimmed[0].end).toBe(2000)
    expect(trimmed[0].words[0].end).toBe(2000)
    const kept = preprocessLyricLines([line(0, 2600), line(2000, 4000)])
    expect(kept[0].end).toBe(2600)
  })

  it('提前起唱：无重叠时提前 600ms，重叠时提前 400ms 或重叠的 70%，不早于上一行开始', () => {
    const [, b] = preprocessLyricLines([line(0, 1000), line(3000, 4000)])
    expect(b.start).toBe(2400)
    // 空隙不足 600ms 时最多提前到上一行结束；紧挨着的快歌短行不提前，不会同时高亮
    const [, gap] = preprocessLyricLines([line(0, 1000), line(1200, 2000)])
    expect(gap.start).toBe(1000)
    const fast = preprocessLyricLines([line(0, 300), line(300, 600), line(600, 900), line(900, 1200)])
    expect(fast.map(item => item.start)).toEqual([0, 300, 600, 900])
    // 有意重叠 600ms（≥ 500ms 保留）：提前 400ms
    const [, c] = preprocessLyricLines([line(0, 3600), line(3000, 5000)])
    expect(c.start).toBe(2600)
    // 重叠 200ms 且超过下一行时长的 10%：保留重叠，提前 140ms
    const [, d] = preprocessLyricLines([line(0, 3200), line(3000, 4000)])
    expect(d.start).toBe(2860)
    // 第一行从 0.3 秒开始：不早于 0
    expect(preprocessLyricLines([line(300, 1000)])[0].start).toBe(0)
    // 词的时间不变
    expect(b.words[0].start).toBe(3000)
  })
})

describe('时间线（8.6、8.7）', () => {
  const lines = [line(1000, 3000), line(3000, 5000), line(5000, 6000), line(14000, 16000)]
  const items = buildTimeline(lines)

  it('相邻行空隙 ≥ 7 秒插入间奏，末尾为底栏', () => {
    expect(items.map(item => item.kind)).toEqual(['line', 'line', 'line', 'interlude', 'line', 'footer'])
    expect(buildTimeline([line(8000, 9000)])[0]).toEqual({ kind: 'interlude', start: 0, end: 8000 })
  })

  it('高亮行与焦点', () => {
    expect(getTimelineState(lines, items, 3500)).toEqual({ active: [1], focus: 1, interlude: null })
    // 间奏：清空高亮，焦点交给间奏点
    expect(getTimelineState(lines, items, 9000)).toEqual({ active: [], focus: 3, interlude: 3 })
    // 曲末聚焦底栏
    expect(getTimelineState(lines, items, 20000).focus).toBe(5)
    // 第一行开始前：焦点在第一行，不高亮
    expect(getTimelineState(lines, items, 0)).toEqual({ active: [], focus: 0, interlude: null })
  })

  it('多行重叠同时高亮；句间短空隙内上一行保持高亮', () => {
    const overlapped = [line(0, 3000), line(2000, 4000), line(5000, 6000)]
    const overlapItems = buildTimeline(overlapped)
    expect(getTimelineState(overlapped, overlapItems, 2500).active).toEqual([0, 1])
    expect(getTimelineState(overlapped, overlapItems, 4500)).toEqual({ active: [1], focus: 1, interlude: null })
  })

  it('某一时刻的那一句（静态显示用）：间奏、开唱前与曲末为空，背景和声取主唱行', () => {
    const texts = [line(1000, 3000, 'a'), line(3000, 4500, 'b'), line(5000, 6000, 'c'), line(14000, 16000, 'd')]
    const textItems = buildTimeline(texts)
    expect(getLineTextAt(texts, textItems, 3500)).toBe('b')
    // 句间短空隙内仍是刚唱完的那一句
    expect(getLineTextAt(texts, textItems, 4700)).toBe('b')
    expect(getLineTextAt(texts, textItems, 9000)).toBeNull()
    expect(getLineTextAt(texts, textItems, 500)).toBeNull()
    expect(getLineTextAt(texts, textItems, 20000)).toBeNull()
    expect(getLineTextAt([], buildTimeline([]), 1000)).toBeNull()
    const withBackground = [line(0, 3000, 'main'), { ...line(1000, 4000, 'bg'), isBackground: true }]
    expect(getLineTextAt(withBackground, buildTimeline(withBackground), 3500)).toBe('main')
  })

  it('词进度', () => {
    expect(getWordProgress(1000, 2000, 1500)).toBe(0.5)
    expect(getWordProgress(1000, 2000, 500)).toBe(0)
    expect(getWordProgress(1000, 1000, 1000)).toBe(1)
  })
})

describe('弹簧', () => {
  it('逐渐收敛到目标并停止；延迟期间不动；可瞬移', () => {
    const spring = new Spring(0, { mass: 1, stiffness: 100, damping: 10 })
    spring.setTarget(100, 0.2)
    spring.step(0.1)
    expect(spring.position).toBe(0)
    for (let i = 0; i < 300; i++)
      spring.step(1 / 60)
    expect(spring.position).toBe(100)
    expect(spring.resting).toBe(true)
    spring.jump(-50)
    expect(spring.position).toBe(-50)
  })
})

describe('平台歌词转换', () => {
  it('逐字歌词带翻译与音译，行级歌词整行为一个词', () => {
    const wordTimed = platformToLyrics(parseNcmLyrics({
      yrc: { lyric: '[1000,1000](1000,500,0)一(1500,500,0)句\n[3000,1000](3000,1000,0)二', version: 1 },
      tlyric: { lyric: '[00:01.00]one', version: 1 },
    }), 'ncm')
    expect(wordTimed.source).toBe('ncm-yrc')
    expect(wordTimed.lines[0].words.map(word => [word.text, word.start, word.end])).toEqual([['一', 1000, 1500], ['句', 1500, 2000]])
    expect(wordTimed.lines.map(item => item.translation)).toEqual(['one', undefined])

    const lineTimed = platformToLyrics(parseNcmLyrics({ lrc: { lyric: '[00:01.00]甲\n[00:04.00]乙', version: 1 } }), 'ncm')
    expect(lineTimed.wordTimed).toBe(false)
    expect(lineTimed.lines[0].words).toEqual([{ text: '甲', start: 1000, end: 4000 }])
  })

  it('纯音乐占位', () => {
    const result = platformToLyrics(parseNcmLyrics({ lrc: { lyric: '[00:00.00]pure_music_without_lyric', version: 1 } }), 'ncm')
    expect(result.instrumental).toBe(true)
    expect(result.lines).toEqual([])
  })
})

describe('多来源选择', () => {
  const ttmlLine = (start: number, text: string): LyricLine => ({ words: [{ text, start, end: start + 1000 }], start, end: start + 1000, isDuet: false, isBackground: false })
  const ttml: ResolvedLyrics = { source: 'ttml-amll', wordTimed: true, instrumental: false, lines: [ttmlLine(1000, '一'), ttmlLine(3000, '二')] }
  const ncmParsed = parseNcmLyrics({
    lrc: { lyric: '[00:01.10]一\n[00:03.20]二', version: 1 },
    tlyric: { lyric: '[00:01.10]one\n[00:03.20]two', version: 1 },
    romalrc: { lyric: '[00:01.10]ichi\n[00:03.20]罗马音由AI生成', version: 1 },
  })
  const ncm = platformToLyrics(ncmParsed, 'ncm')

  it('优先 TTML；固定来源时使用固定的来源', () => {
    expect(resolveLyrics({ ttml, ncm, ncmParsed, pin: null }).kind).toBe('ttml')
    expect(resolveLyrics({ ttml, ncm, ncmParsed, pin: 'ncm' }).kind).toBe('ncm')
    // 固定的来源没有歌词时回落到自动选择
    expect(resolveLyrics({ ttml: null, ncm, ncmParsed, pin: 'ttml' }).kind).toBe('ncm')
    expect(resolveLyrics({ ttml: null, ncm: null, ncmParsed: null, pin: null }).kind).toBeNull()
  })

  it('缺翻译与音译的 TTML 向平台借，含中日文字符的音译不借', () => {
    const { lyrics } = resolveLyrics({ ttml, ncm, ncmParsed, pin: null })
    expect(lyrics.lines.map(line => line.translation)).toEqual(['one', 'two'])
    expect(lyrics.lines.map(line => line.romanization)).toEqual(['ichi', undefined])
  })

  it('等级：TTML > 逐字 > 逐行', () => {
    expect(lyricTier(ttml)).toBeLessThan(lyricTier({ ...ncm, wordTimed: true }))
    expect(lyricTier({ ...ncm, wordTimed: true })).toBeLessThan(lyricTier(ncm))
  })
})

describe('歌词来源：QQ 音乐', () => {
  const qqInput = {
    format: 'qrc',
    lyric: [
      '[ti:歌]',
      '[kana:1う(20699,19)]',
      '[0,900]歌(0,300) (300,300)-(600,300) (900,0)歌手(900,0)',
      '[1000,1000]你(1000,500)好(1500,500)',
      '[2000,600] (2000,300)(这)(2300,300)',
      '[3000,1000]再(3000,500)见(3500,500)',
    ].join('\n'),
    translation: '[00:00.00]//\n[00:01.00]hello\n[00:03.00]//',
    romanization: '[1000,1000]ni (1000,500)hao(1500,500)\n[3000,1000]以下由AI生成(3000,1000)',
  }

  it('qRC：字在时间标签之前，非数字的括号保留为文字，元信息行不是歌词', () => {
    const parsed = parseQqLyrics(qqInput)
    expect(parsed.sourceType).toBe('qrc')
    expect(parsed.lines.map(line => getLyricLineText(line))).toEqual(['歌 - 歌手', '你好', '(这)', '再见'])
    expect(parsed.lines[1].words).toEqual([{ text: '你', start: 1000, end: 1500 }, { text: '好', start: 1500, end: 2000 }])
    // 「//」表示没有翻译；含中日文字符的音译不挂
    expect(parsed.translations.map(line => line.text)).toEqual(['hello'])
    expect(parsed.romanizations.map(line => line.text)).toEqual(['ni hao'])
  })

  it('转换时去掉「歌名 - 歌手」行，逐字歌词为 qq-qrc', () => {
    const lyrics = platformToLyrics(parseQqLyrics(qqInput), 'qq', { name: '歌', artists: ['歌手'] })
    expect(lyrics.source).toBe('qq-qrc')
    expect(lyrics.wordTimed).toBe(true)
    expect(lyrics.lines.map(line => line.words.map(word => word.text).join(''))).toEqual(['你好', '(这)', '再见'])
    expect(lyrics.lines[0].translation).toBe('hello')
    expect(lyrics.lines[0].romanization).toBe('ni hao')
  })

  it('纯音乐占位', () => {
    const lyrics = platformToLyrics(parseQqLyrics({ format: 'lrc', lyric: '[00:00.00]此歌曲为没有填词的纯音乐，请您欣赏', translation: '', romanization: '' }), 'qq')
    expect(lyrics.instrumental).toBe(true)
    expect(lyrics.lines).toEqual([])
  })

  it('按质量选择：等级优先；同一等级比自带的翻译与音译，仍相同时网易云优先；固定来源时使用它', () => {
    const ncmLine = platformToLyrics(parseNcmLyrics({ lrc: { lyric: '[00:01.00]你好\n[00:03.00]再见', version: 1 } }), 'ncm')
    const ncmWordParsed = parseNcmLyrics({ yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,500,0)再(3500,500,0)见', version: 1 } })
    const ncmWord = platformToLyrics(ncmWordParsed, 'ncm')
    const ncmFull = {
      ...ncmWord,
      lines: ncmWord.lines.map(line => ({ ...line, translation: '译', romanization: 'yi' })),
    }
    const qqParsed = parseQqLyrics(qqInput)
    const qq = platformToLyrics(qqParsed, 'qq')

    // 等级：逐字 > 逐行
    expect(resolveLyrics({ ttml: null, ncm: ncmLine, ncmParsed: null, qq, qqParsed, pin: null }).kind).toBe('qq')
    // 同为逐字：QQ 音乐自带翻译与音译，比没有的网易云好
    expect(resolveLyrics({ ttml: null, ncm: ncmWord, ncmParsed: ncmWordParsed, qq, qqParsed, pin: null }).kind).toBe('qq')
    // 翻译与音译同样齐全时网易云优先（时间轴与播放的音频一致）
    expect(resolveLyrics({ ttml: null, ncm: ncmFull, ncmParsed: null, qq, qqParsed, pin: null }).kind).toBe('ncm')
    expect(resolveLyrics({ ttml: null, ncm: ncmFull, ncmParsed: null, qq, qqParsed, pin: 'qq' }).kind).toBe('qq')
  })

  it('每个来源缺翻译时都向其余平台借，借来的不影响排序', () => {
    const ncmWordParsed = parseNcmLyrics({ yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,500,0)再(3500,500,0)见', version: 1 } })
    const ncmWord = platformToLyrics(ncmWordParsed, 'ncm')
    const qqParsed = parseQqLyrics(qqInput)
    const qq = platformToLyrics(qqParsed, 'qq')
    const { candidates } = resolveLyrics({ ttml: null, ncm: ncmWord, ncmParsed: ncmWordParsed, qq, qqParsed, pin: null })
    const borrowed = candidates.find(candidate => candidate.kind === 'ncm')!.lyrics
    expect(candidates.map(candidate => candidate.kind)).toEqual(['qq', 'ncm'])
    expect(borrowed.lines[0].translation).toBe(qq.lines.find(line => line.words.map(word => word.text).join('') === '你好')?.translation)
  })
})

describe('翻译 / 音译挂载（宁缺勿错）', () => {
  const baseStarts = [0, 2000, 4000, 6000]

  it('只挂到时间相近的主行，没有翻译的行不借用相邻行', () => {
    // B、D 没有翻译：不应挂上 A、C 的翻译
    const aligned = alignTimedTexts(baseStarts, [{ start: 10, text: 'a' }, { start: 3990, text: 'c' }])
    expect(baseStarts.map((_, index) => aligned.get(index) ?? null)).toEqual(['a', null, 'c', null])
  })

  it('一行翻译只挂一行主歌词，时间差超出上限的丢弃', () => {
    const aligned = alignTimedTexts(baseStarts, [{ start: 1000, text: 'between' }, { start: 9000, text: 'far' }])
    // 1000ms 处与 A、B 等距：只挂一行
    expect(aligned.size).toBe(1)
    expect(aligned.get(3)).toBeUndefined()
  })

  it('同一主行有多个候选时取时间最近的', () => {
    const aligned = alignTimedTexts(baseStarts, [{ start: 1800, text: 'near' }, { start: 2600, text: 'farther' }])
    expect(aligned.get(1)).toBe('near')
    // 次近的那行离 C 也超过上限，被丢弃
    expect(aligned.get(2)).toBeUndefined()
  })

  it('解析网易云歌词时翻译与逐字主行对齐', () => {
    const parsed = parseNcmLyrics({
      yrc: { lyric: '[1000,1000](1000,500,0)一(1500,500,0)句\n[3000,1000](3000,1000,0)二', version: 1 },
      tlyric: { lyric: '[00:01.05]line one', version: 1 },
    })
    expect(parsed.sourceType).toBe('yrc')
    expect(parsed.translations).toEqual([{ start: 1000, text: 'line one' }])
  })
})

describe('逐字歌词跑马灯（分段匀变速）', () => {
  // [开始时间, 时长, 字宽]：各字速度不同，1600~1800、3100~3300 为字间空隙
  const syllables: [number, number, number][] = [
    [1000, 200, 40],
    [1200, 300, 30],
    [1500, 100, 30],
    [1800, 400, 80],
    [2200, 150, 60],
    [2350, 250, 25],
    [2600, 500, 75],
    [3300, 200, 90],
    [3500, 300, 60],
    [3800, 400, 120],
  ]
  const words: LyricWord[] = []
  const wordBoxes: LyricMarqueeWordBox[] = []
  let contentWidth = 0
  for (const [startTime, duration, width] of syllables) {
    words.push({ text: '字', start: startTime, end: startTime + duration })
    wordBoxes.push({ left: contentWidth, width })
    contentWidth += width
  }
  const containerWidth = 200
  const overflow = contentWidth - containerWidth
  const wordLine: LyricLine = { words, start: 1000, end: 4200, isDuet: false, isBackground: false }
  const offsetAt = (currentTimeMs: number, smoothWindowMs?: number) =>
    getLyricMarqueeOffset({ line: wordLine, currentTimeMs, containerWidth, contentWidth, wordBoxes, smoothWindowMs })
  const half = LYRIC_MARQUEE_SMOOTH_WINDOW_MS / 2
  const lineEnd = 4200

  // 原偏移速度突变的时刻：各字边界，以及演唱位置越过滚动起点、终点的时刻
  const crossingTime = (position: number) => {
    const i = wordBoxes.findIndex(box => box.left + box.width > position)
    return words[i].start + (position - wordBoxes[i].left) / wordBoxes[i].width * (words[i].end - words[i].start)
  }
  const anchor = containerWidth * LYRIC_MARQUEE_ANCHOR_RATIO
  const rawKinks = [...new Set(words.flatMap(word => [word.start, word.end])), crossingTime(anchor), crossingTime(anchor + overflow)]
  // 平滑后加速度跳变的时刻：原折点前后各半个窗口
  const kinks = rawKinks.flatMap(time => [time - half, time + half])

  const h = 0.01
  const leftVelocity = (t: number, smoothWindowMs?: number) => (offsetAt(t, smoothWindowMs) - offsetAt(t - h, smoothWindowMs)) / h
  const rightVelocity = (t: number, smoothWindowMs?: number) => (offsetAt(t + h, smoothWindowMs) - offsetAt(t, smoothWindowMs)) / h
  const grid = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

  it('不平滑时速度在字的边界突变（对照）', () => {
    // 2200ms 处由 0.2px/ms 突变为 0.4px/ms
    expect(rightVelocity(2200, 0) - leftVelocity(2200, 0)).toBeCloseTo(0.2, 3)
  })

  it('字的边界、开始滚动与滚到底处速度连续', () => {
    for (const t of [...rawKinks, ...kinks, ...grid(500, 4800, 7)])
      expect(Math.abs(rightVelocity(t) - leftVelocity(t)), `t=${t}`).toBeLessThan(1e-3)
  })

  it('两次加速度跳变之间速度线性变化（匀变速）', () => {
    const delta = 5
    const velocity = (t: number) => (offsetAt(t + h) - offsetAt(t - h)) / (2 * h)
    for (const t of grid(500, 4800, 3)) {
      if (kinks.some(kink => Math.abs(kink - t) <= delta + h))
        continue
      expect(Math.abs(velocity(t) - (velocity(t - delta) + velocity(t + delta)) / 2), `t=${t}`).toBeLessThan(1e-3)
    }
  })

  it('整句起止位置不变', () => {
    for (const t of [0, 900, 1000])
      expect(offsetAt(t)).toBe(0)
    for (const t of [lineEnd, lineEnd + half, lineEnd + 5000]) {
      expect(offsetAt(t)).toBeCloseTo(overflow, 6)
      expect(offsetAt(t)).toBeCloseTo(offsetAt(t, 0), 6)
    }
  })

  it('不超出文本范围，也不倒退', () => {
    let last = 0
    for (const t of grid(0, 5000, 3)) {
      const offset = offsetAt(t)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(overflow)
      expect(offset).toBeGreaterThanOrEqual(last - 1e-9)
      last = offset
    }
  })

  it('跟住演唱位置：介于前后半个窗口时刻的原偏移之间', () => {
    for (const t of grid(500, 4800, 5)) {
      const offset = offsetAt(t)
      expect(offset).toBeGreaterThanOrEqual(offsetAt(t - half, 0) - 1e-9)
      expect(offset).toBeLessThanOrEqual(offsetAt(t + half, 0) + 1e-9)
    }
    // 远离折点的匀速段与原偏移重合
    expect(offsetAt(2850)).toBeCloseTo(offsetAt(2850, 0), 6)
  })
})

describe('去掉署名行', () => {
  const lines = (...texts: string[]) => texts.map((text, i) => line(i * 1000, i * 1000 + 900, text))
  const texts = (result: LyricLine[]) => result.map(item => item.words[0].text)

  it('识别常见署名', () => {
    expect(isCreditText('作词 : 宇多田ヒカル')).toBe(true)
    expect(isCreditText('曲：某人')).toBe(true)
    expect(isCreditText('Producer: Someone')).toBe(true)
    expect(isCreditText('Lyrics by Someone')).toBe(true)
    expect(isCreditText('未经许可，不得翻唱或使用')).toBe(true)
    expect(isCreditText('愛：それはきっと')).toBe(false)
    expect(isCreditText('初めてのルーブルは')).toBe(false)
  })

  it('只去掉首尾连续的署名，歌名单独成行只在开头去掉', () => {
    const result = stripCredits(lines('One Last Kiss', '宇多田ヒカル', '作词：甲', '第一句', '作词：乙', '第二句', 'One Last Kiss', '制作人：丙'), { name: 'One Last Kiss', artists: ['宇多田ヒカル'] })
    expect(texts(result)).toEqual(['第一句', '作词：乙', '第二句', 'One Last Kiss'])
  })

  it('qQ 音乐常见的长署名段（「合声」「录音助理」等）整段去掉', () => {
    const result = stripCredits(lines('晴天 - 周杰伦 (Jay Chou)', '词：周杰伦', '编曲：周杰伦', '制作人：周杰伦', '合声：周杰伦', '合声编写：周杰伦', '吉他：某人', '鼓：某人', '录音助理：某人', '混音工程：某人（某工作室）', '故事的小黄花'), { name: '晴天', artists: ['周杰伦'] })
    expect(texts(result)).toEqual(['故事的小黄花'])
  })

  it('不会把所有行都去掉', () => {
    const all = lines('作词：甲', '作曲：乙')
    expect(stripCredits(all)).toBe(all)
  })
})

describe('快歌：紧挨着的短行', () => {
  it('任意时刻最多一行高亮，焦点逐行前进，不会停在第一行', () => {
    const lines = preprocessLyricLines(Array.from({ length: 40 }, (_, i) => line(1000 + i * 350, 1350 + i * 350, `第${i}行`)))
    const items = buildTimeline(lines)
    let lastFocus = -1
    for (let t = 1000; t < 1000 + 40 * 350; t += 50) {
      const state = getTimelineState(lines, items, t)
      expect(state.active.length).toBeLessThanOrEqual(1)
      expect(state.focus).toBeGreaterThanOrEqual(lastFocus)
      lastFocus = state.focus
    }
    expect(getTimelineState(lines, items, 1000 + 20 * 350 + 10).active).toEqual([20])
  })
})
