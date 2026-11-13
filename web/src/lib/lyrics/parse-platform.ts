import type { TimedText } from './line-utils'
import type { LyricLine, LyricWord } from './types'
import type { MusicLyrics } from '@/api/music'
import { alignTimedTexts, getLyricLineText } from './line-utils'

export interface PlatformTimedItem {
  text: string
  start: number
  end: number
}

export interface PlatformExtraLine extends TimedText {
  items?: PlatformTimedItem[]
}

export interface PlatformLyricParsed {
  // yrc / qrc 为逐字（网易云 / QQ 音乐 / 酷狗音乐），lrc 为逐行
  sourceType: 'yrc' | 'qrc' | 'lrc' | 'none'
  lines: LyricLine[]
  translations: TimedText[]
  romanizations: PlatformExtraLine[]
}

/** QQ 音乐歌词（后端已解密并去掉 XML 外壳）：format 为 qrc（逐字）或 lrc；翻译为 LRC，音译与正文同格式 */
export interface QqLyricInput {
  format: string
  lyric: string
  translation: string
  romanization: string
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** 解析标准 LRC 文本为逐行 LyricLine（行自身 end 等于 start，表示无独立结束时长） */
export function parseLrcLines(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = []
  const lineRegex = /\[(\d{2,3}):(\d{2})\.(\d{2,3})\](.*)/g

  let match = lineRegex.exec(lrcText)
  while (match !== null) {
    const [, minutes, seconds, ms, text] = match
    const start = (Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10)) * 1000
      + Number.parseInt(ms.padEnd(3, '0').slice(0, 3), 10)
    const trimmedText = text.trim()

    if (trimmedText) {
      lines.push({
        words: [{ text: trimmedText, start, end: start }],
        start,
        end: start,
        isDuet: false,
        isBackground: false,
      })
    }
    match = lineRegex.exec(lrcText)
  }

  return lines.sort((a, b) => a.start - b.start)
}

function parseYrcLine(lineText: string): LyricLine | null {
  if (lineText.trim().startsWith('{'))
    return null

  const lineMatch = lineText.match(/^\[(\d+),(\d+)\]/)
  if (!lineMatch)
    return null

  const lineStart = Number.parseInt(lineMatch[1], 10)
  const lineDuration = Number.parseInt(lineMatch[2], 10)
  const content = lineText.slice(lineMatch[0].length)
  const words: LyricWord[] = []
  const wordRegex = /\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)/g

  let wordMatch = wordRegex.exec(content)
  while (wordMatch !== null) {
    const wordStart = Number.parseInt(wordMatch[1], 10)
    const wordDuration = Number.parseInt(wordMatch[2], 10)
    const wordText = wordMatch[3]

    if (wordText)
      words.push({ text: wordText, start: wordStart, end: wordStart + wordDuration })
    wordMatch = wordRegex.exec(content)
  }

  if (words.length === 0)
    return null

  const last = words[words.length - 1]
  const duration = Math.max(lineDuration, last.end - lineStart)

  return {
    words,
    start: lineStart,
    end: lineStart + duration,
    isDuet: false,
    isBackground: false,
  }
}

function parseYrc(yrcText: string): LyricLine[] {
  return yrcText
    .split('\n')
    .map(line => parseYrcLine(line.trim()))
    .filter((line): line is LyricLine => Boolean(line))
    .sort((a, b) => a.start - b.start)
}

/**
 * QRC（QQ 音乐逐字歌词）的一行：[行开始,行时长]字(开始,时长)字(开始,时长)…，时间为绝对毫秒，字在时间标签之前。
 * 不是数字标签的括号（如歌词里的「(」）保留为文字
 */
function parseQrcLine(lineText: string): LyricLine | null {
  const lineMatch = lineText.match(/^\[(\d+),(\d+)\]/)
  if (!lineMatch)
    return null

  const lineStart = Number.parseInt(lineMatch[1], 10)
  const lineDuration = Number.parseInt(lineMatch[2], 10)
  const content = lineText.slice(lineMatch[0].length)
  const words: LyricWord[] = []
  const wordRegex = /([\s\S]*?)\((\d+),(\d+)\)/g

  let wordMatch = wordRegex.exec(content)
  while (wordMatch !== null) {
    if (wordMatch[1]) {
      const start = Number.parseInt(wordMatch[2], 10)
      const duration = Number.parseInt(wordMatch[3], 10)
      words.push({ text: wordMatch[1], start, end: start + duration })
    }
    wordMatch = wordRegex.exec(content)
  }

  const text = words.map(word => word.text).join('').trim()
  if (!text)
    return null
  const last = words[words.length - 1]
  return {
    words,
    start: lineStart,
    end: lineStart + Math.max(lineDuration, last.end - lineStart),
    isDuet: false,
    isBackground: false,
  }
}

function parseQrc(qrcText: string): LyricLine[] {
  return qrcText
    .split('\n')
    .map(line => parseQrcLine(line.trim()))
    .filter((line): line is LyricLine => Boolean(line))
    .sort((a, b) => a.start - b.start)
}

function sanitizeExtraLines(lines: LyricLine[], keepItems = false): PlatformExtraLine[] {
  const result: PlatformExtraLine[] = []
  for (const line of lines) {
    // 逐字条目不能 trim：英文等拉丁文字的词间空格就保存在条目首尾，trim 会让单词粘连
    const items = line.words
      .map(word => ({ ...word, text: word.text.replace(/〖|〗/g, '') }))
      .filter(word => word.text !== '')
    const text = getLyricLineText(line).replace(/〖|〗/g, '').trim()
    if (!text)
      continue
    result.push({
      start: line.start,
      text,
      ...(keepItems && items.some(item => item.end > item.start) ? { items } : undefined),
    })
  }
  return result
}

function alignPlatformExtras<T extends TimedText>(lines: LyricLine[], extras: T[]): T[] {
  if (lines.length === 0 || extras.length === 0)
    return []
  const baseStarts = lines.map(line => line.start)
  const pairs: { offset: number, base: number, extra: number }[] = []
  extras.forEach((extraItem, extra) => {
    baseStarts.forEach((baseStart, base) => {
      const offset = Math.abs(baseStart - extraItem.start)
      if (offset <= 1000)
        pairs.push({ offset, base, extra })
    })
  })
  pairs.sort((a, b) => a.offset - b.offset)

  const usedBase = new Set<number>()
  const assigned = new Map<number, number>()
  for (const { base, extra } of pairs) {
    if (usedBase.has(base) || assigned.has(extra))
      continue
    usedBase.add(base)
    assigned.set(extra, base)
  }
  return [...assigned.entries()]
    .map(([extra, base]) => ({ ...extras[extra], start: baseStarts[base] }))
    .sort((a, b) => a.start - b.start)
}

function parseNcmExtra(lyricText: string | undefined): PlatformExtraLine[] {
  const trimmed = lyricText?.trim()
  if (!trimmed)
    return []
  const parsed = /^\[\d+,\d+\]/m.test(trimmed) ? parseYrc(trimmed) : parseLrcLines(trimmed)
  return sanitizeExtraLines(parsed, false)
}

/** 解析网易云歌词（YRC 逐字优先，回退 LRC）及翻译、音译 */
export function parseNcmLyrics(rawLyric: MusicLyrics | null): PlatformLyricParsed {
  const rawTranslations = parseNcmExtra(rawLyric?.ytlrc?.lyric?.trim() || rawLyric?.tlyric?.lyric?.trim())
  const rawRomaji = parseNcmExtra(rawLyric?.yromalrc?.lyric?.trim() || rawLyric?.romalrc?.lyric?.trim())

  const yrcText = rawLyric?.yrc?.lyric?.trim()
  if (yrcText) {
    const lines = parseYrc(yrcText)
    if (lines.length > 0) {
      return {
        sourceType: 'yrc',
        lines,
        translations: alignPlatformExtras(lines, rawTranslations),
        romanizations: alignPlatformExtras(lines, rawRomaji),
      }
    }
  }

  const lrcText = rawLyric?.lrc?.lyric?.trim()
  if (lrcText) {
    const lines = parseLrcLines(lrcText)
    if (lines.length > 0) {
      return {
        sourceType: 'lrc',
        lines,
        translations: alignPlatformExtras(lines, rawTranslations),
        romanizations: alignPlatformExtras(lines, rawRomaji),
      }
    }
  }

  return { sourceType: 'none', lines: [], translations: [], romanizations: [] }
}

/**
 * 解析 QQ 音乐 / 酷狗音乐歌词：
 * 翻译中的「//」表示这一行没有翻译，含中日韩文字的音译行多为说明文字，均不挂载
 */
export function parseQqLyrics(input: QqLyricInput | null): PlatformLyricParsed {
  const empty: PlatformLyricParsed = { sourceType: 'none', lines: [], translations: [], romanizations: [] }
  const text = input?.lyric?.trim()
  if (!text)
    return empty
  const qrc = input!.format === 'qrc'
  const lines = qrc ? parseQrc(text) : parseLrcLines(text)
  if (lines.length === 0)
    return empty

  const parseExtra = (extra: string | undefined, keepItems: boolean) => {
    const trimmed = extra?.trim()
    if (!trimmed)
      return []
    return sanitizeExtraLines(/^\[\d+,\d+\]/m.test(trimmed) ? parseQrc(trimmed) : parseLrcLines(trimmed), keepItems)
  }

  return {
    sourceType: qrc ? 'qrc' : 'lrc',
    lines,
    translations: alignPlatformExtras(lines, parseExtra(input!.translation, false).filter(item => item.text !== '//')),
    romanizations: alignPlatformExtras(lines, parseExtra(input!.romanization, qrc).filter(item => !CJK_RE.test(item.text))),
  }
}

/** 解析 LRC 格式的附加歌词（如作者手填的翻译 / 发音）并按时间对齐到主歌词行 */
export function alignLrcExtraToLines(lines: LyricLine[], extraLrc: string): Map<number, string> {
  const extras = sanitizeExtraLines(parseLrcLines(extraLrc), false)
  return alignTimedTexts(lines.map(line => line.start), extras)
}
