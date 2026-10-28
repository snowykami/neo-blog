import type { MusicLyrics } from '@/api/music'
import { isKana, isRomaji, toRomaji } from 'wanakana'

export interface MusicLyricItem {
  text: string
  startTime: number
  duration: number
}

export interface MusicLyricLine {
  items: MusicLyricItem[]
  startTime: number
  duration: number
  originalText: string
}

export interface MusicLyricParseResult {
  // yrc / qrc 为逐字（网易云 / QQ 音乐），lrc 为逐行
  sourceType: 'yrc' | 'qrc' | 'lrc' | 'none'
  lines: MusicLyricLine[]
  translationLines: MusicLyricLine[]
  romajiLines: MusicLyricLine[]
}

/** 没有歌词时歌词接口返回的占位文本，不应作为歌词展示 */
export const LYRIC_PLACEHOLDERS = new Set(['no_lyric', 'pure_music_without_lyric'])

interface TimedRomajiUnit {
  text: string
  reading: string
  startTime: number
  duration: number
}

const JAPANESE_PUNCTUATION_RE = /^[\s、。，．・･！？!?…♪「」『』（）()[\]【】〈〉《》“”"'‘’—~〜-]+$/
const SMALL_KANA_RE = /^[ゃゅょャュョぁぃぅぇぉァィゥェォゎヮヶヵ]$/
const ATTACH_TO_PREVIOUS_RE = /^[ーｰ〜~]$/
const ATTACH_TO_NEXT_RE = /^[っッ]$/
const LATIN_OR_NUMBER_RE = /[a-z0-9]/i

function parseLrc(lrcText: string): MusicLyricLine[] {
  const lines: MusicLyricLine[] = []
  const lineRegex = /\[(\d{2,3}):(\d{2})\.(\d{2,3})\](.*)/g

  let match = lineRegex.exec(lrcText)
  while (match !== null) {
    const [, minutes, seconds, ms, text] = match
    const startTime = (Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10)) * 1000 + Number.parseInt(ms.padEnd(3, '0').slice(0, 3), 10)
    const trimmedText = text.trim()

    if (trimmedText) {
      lines.push({
        items: [{ text: trimmedText, startTime, duration: 0 }],
        startTime,
        duration: 0,
        originalText: trimmedText,
      })
    }
    match = lineRegex.exec(lrcText)
  }

  return lines.sort((a, b) => a.startTime - b.startTime)
}

function sanitizeExtraLyricLines(lines: MusicLyricLine[]): MusicLyricLine[] {
  return lines.map(line => ({
    ...line,
    // 逐字条目不能 trim：英文等拉丁文字的词间空格就保存在条目首尾，trim 会让单词粘连
    items: line.items
      .map(item => ({ ...item, text: item.text.replace(/〖|〗/g, '') }))
      .filter(item => item.text !== ''),
    originalText: line.originalText.replace(/〖|〗/g, '').trim(),
  })).filter(line => line.originalText)
}

function parseYrcLine(lineText: string): MusicLyricLine | null {
  if (lineText.trim().startsWith('{'))
    return null

  const lineMatch = lineText.match(/^\[(\d+),(\d+)\]/)
  if (!lineMatch)
    return null

  const lineStartTime = Number.parseInt(lineMatch[1], 10)
  const lineDuration = Number.parseInt(lineMatch[2], 10)
  const content = lineText.slice(lineMatch[0].length)
  const items: MusicLyricItem[] = []
  const wordRegex = /\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)/g

  let wordMatch = wordRegex.exec(content)
  while (wordMatch !== null) {
    const wordStartTime = Number.parseInt(wordMatch[1], 10)
    const wordDuration = Number.parseInt(wordMatch[2], 10)
    const wordText = wordMatch[3]

    if (wordText) {
      items.push({ text: wordText, startTime: wordStartTime, duration: wordDuration })
    }
    wordMatch = wordRegex.exec(content)
  }

  if (items.length === 0)
    return null

  const last = items[items.length - 1]
  const duration = Math.max(lineDuration, (last.startTime + last.duration) - lineStartTime)
  const originalText = items.map(item => item.text).join('').trim()

  return {
    items,
    startTime: lineStartTime,
    duration,
    originalText: originalText || content,
  }
}

function parseYrc(yrcText: string): MusicLyricLine[] {
  return yrcText
    .split('\n')
    .map(line => parseYrcLine(line.trim()))
    .filter((line): line is MusicLyricLine => Boolean(line))
    .sort((a, b) => a.startTime - b.startTime)
}

/**
 * QRC（QQ 音乐逐字歌词）的一行：[行开始,行时长]字(开始,时长)字(开始,时长)…，时间为绝对毫秒，字在时间标签之前。
 * 不是数字标签的括号（如歌词里的「(」）保留为文字
 */
function parseQrcLine(lineText: string): MusicLyricLine | null {
  const lineMatch = lineText.match(/^\[(\d+),(\d+)\]/)
  if (!lineMatch)
    return null

  const lineStartTime = Number.parseInt(lineMatch[1], 10)
  const lineDuration = Number.parseInt(lineMatch[2], 10)
  const content = lineText.slice(lineMatch[0].length)
  const items: MusicLyricItem[] = []
  const wordRegex = /([\s\S]*?)\((\d+),(\d+)\)/g

  let wordMatch = wordRegex.exec(content)
  while (wordMatch !== null) {
    if (wordMatch[1])
      items.push({ text: wordMatch[1], startTime: Number.parseInt(wordMatch[2], 10), duration: Number.parseInt(wordMatch[3], 10) })
    wordMatch = wordRegex.exec(content)
  }

  const originalText = items.map(item => item.text).join('').trim()
  if (!originalText)
    return null
  const last = items[items.length - 1]
  return {
    items,
    startTime: lineStartTime,
    duration: Math.max(lineDuration, (last.startTime + last.duration) - lineStartTime),
    originalText,
  }
}

function parseQrc(qrcText: string): MusicLyricLine[] {
  return qrcText
    .split('\n')
    .map(line => parseQrcLine(line.trim()))
    .filter((line): line is MusicLyricLine => Boolean(line))
    .sort((a, b) => a.startTime - b.startTime)
}

function parseExtraLyric(lyricText: string | undefined): MusicLyricLine[] {
  if (!lyricText)
    return []

  const trimmedText = lyricText.trim()
  const parsedLines = /^\[\d+,\d+\]/m.test(trimmedText)
    ? parseYrc(trimmedText)
    : parseLrc(trimmedText)

  return sanitizeExtraLyricLines(parsedLines)
}

function splitRomajiText(text: string): string[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  return tokens.map((token, index) => index < tokens.length - 1 ? `${token} ` : token)
}

function normalizeRomajiText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function getItemReading(text: string): string {
  if (isRomaji(text))
    return normalizeRomajiText(text)
  if (isKana(text))
    return normalizeRomajiText(toRomaji(text))
  return normalizeRomajiText(text)
}

function getItemEndTime(item: MusicLyricItem): number {
  return item.startTime + item.duration
}

function createTimedUnit(items: MusicLyricItem[]): TimedRomajiUnit | null {
  if (items.length === 0)
    return null

  const startTime = items[0].startTime
  const endTime = items.reduce((end, item) => Math.max(end, getItemEndTime(item)), startTime)
  const text = items.map(item => item.text).join('')

  return {
    text,
    reading: getItemReading(text),
    startTime,
    duration: Math.max(0, endTime - startTime),
  }
}

function createTimedRomajiUnits(baseLine: MusicLyricLine): TimedRomajiUnit[] {
  const units: TimedRomajiUnit[] = []
  let pending: MusicLyricItem[] = []
  let attachNext: MusicLyricItem[] = []

  const flush = () => {
    const unit = createTimedUnit(pending)
    if (unit)
      units.push(unit)
    pending = []
  }

  for (const item of baseLine.items) {
    const text = item.text.trim()
    if (!text || JAPANESE_PUNCTUATION_RE.test(text))
      continue

    if (ATTACH_TO_NEXT_RE.test(text)) {
      attachNext.push(item)
      continue
    }

    if (ATTACH_TO_PREVIOUS_RE.test(text) || SMALL_KANA_RE.test(text)) {
      pending.push(item)
      continue
    }

    flush()
    pending = [...attachNext, item]
    attachNext = []

    if (LATIN_OR_NUMBER_RE.test(text))
      flush()
  }

  if (attachNext.length > 0)
    pending.push(...attachNext)
  flush()

  return units
}

function splitRomajiTokenParts(tokens: string[]): string[] {
  return tokens.flatMap((token) => {
    const trailingSpace = token.match(/\s+$/)?.[0] ?? ''
    const trimmedToken = token.trim()
    if (!trimmedToken)
      return []

    const parts = trimmedToken.match(/[a-z0-9]+|[^a-z0-9\s]+/gi) ?? [trimmedToken]
    return parts.map((part, index) => index === parts.length - 1 ? `${part}${trailingSpace}` : part)
  })
}

function getUnitOffsetTime(unit: TimedRomajiUnit, offset: number): number {
  const readingLength = Math.max(1, unit.reading.length)
  const boundedOffset = Math.max(0, Math.min(readingLength, offset))
  return Math.round(unit.startTime + unit.duration * boundedOffset / readingLength)
}

function buildProportionalItemsInRange(tokens: string[], startTime: number, duration: number): MusicLyricItem[] {
  const tokenReadings = tokens.map(token => normalizeRomajiText(token))
  const totalReadingLength = tokenReadings.reduce((total, reading) => total + Math.max(1, reading.length), 0)
  let readingOffset = 0

  return tokens.map((token, index) => {
    const tokenReadingLength = Math.max(1, tokenReadings[index].length)
    const startRatio = readingOffset / totalReadingLength
    readingOffset += tokenReadingLength
    const endRatio = readingOffset / totalReadingLength
    const itemStartTime = Math.round(startTime + duration * startRatio)
    const itemEndTime = Math.round(startTime + duration * endRatio)

    return {
      text: token,
      startTime: itemStartTime,
      duration: Math.max(0, itemEndTime - itemStartTime),
    }
  })
}

function getUnitsEndTime(units: TimedRomajiUnit[]): number {
  return units.reduce((endTime, unit) => Math.max(endTime, unit.startTime + unit.duration), 0)
}

function canTokenStartReading(token: string, reading: string): boolean {
  const normalizedToken = normalizeRomajiText(token)
  return Boolean(normalizedToken) && (reading.startsWith(normalizedToken) || normalizedToken.startsWith(reading))
}

function buildUnitBasedRomajiItems(baseLine: MusicLyricLine, tokens: string[]): MusicLyricItem[] | null {
  const units = createTimedRomajiUnits(baseLine)
  if (units.length === 0)
    return null

  const tokenParts = splitRomajiTokenParts(tokens)
  if (tokenParts.length === 0)
    return null

  const items: MusicLyricItem[] = []
  let unitIndex = 0
  let unitOffset = 0

  for (let tokenIndex = 0; tokenIndex < tokenParts.length; tokenIndex += 1) {
    const token = tokenParts[tokenIndex]
    const normalizedToken = normalizeRomajiText(token)

    if (!normalizedToken)
      continue

    let remainingToken = normalizedToken
    let tokenStartTime: number | null = null
    let tokenEndTime: number | null = null
    let handledUnknownUnit = false

    while (remainingToken) {
      const unit = units[unitIndex]
      if (!unit)
        return null

      if (!unit.reading) {
        let nextReadableUnitIndex = unitIndex + 1
        while (nextReadableUnitIndex < units.length && !units[nextReadableUnitIndex].reading)
          nextReadableUnitIndex += 1

        if (nextReadableUnitIndex >= units.length) {
          const remainingTokens = tokenParts.slice(tokenIndex).filter(part => normalizeRomajiText(part))
          const remainingUnits = units.slice(unitIndex)
          const startTime = unit.startTime
          const endTime = getUnitsEndTime(remainingUnits)
          return items.concat(buildProportionalItemsInRange(remainingTokens, startTime, Math.max(0, endTime - startTime)))
        }

        const nextReadableUnit = units[nextReadableUnitIndex]
        const nextTokenIndex = tokenParts.findIndex((part, index) =>
          index > tokenIndex && canTokenStartReading(part, nextReadableUnit.reading),
        )
        if (nextTokenIndex < 0)
          return null

        const unknownTokens = tokenParts.slice(tokenIndex, nextTokenIndex).filter(part => normalizeRomajiText(part))
        const startTime = unit.startTime
        const endTime = nextReadableUnit.startTime
        items.push(...buildProportionalItemsInRange(unknownTokens, startTime, Math.max(0, endTime - startTime)))
        unitIndex = nextReadableUnitIndex
        unitOffset = 0
        tokenIndex = nextTokenIndex - 1
        handledUnknownUnit = true
        remainingToken = ''
        break
      }

      const availableReading = unit.reading.slice(unitOffset)
      if (!availableReading) {
        unitIndex += 1
        unitOffset = 0
        continue
      }

      if (availableReading.startsWith(remainingToken)) {
        const startOffset = unitOffset
        const endOffset = unitOffset + remainingToken.length
        tokenStartTime ??= getUnitOffsetTime(unit, startOffset)
        tokenEndTime = getUnitOffsetTime(unit, endOffset)
        unitOffset = endOffset

        if (unitOffset >= unit.reading.length) {
          unitIndex += 1
          unitOffset = 0
        }
        remainingToken = ''
        break
      }

      if (remainingToken.startsWith(availableReading)) {
        tokenStartTime ??= getUnitOffsetTime(unit, unitOffset)
        tokenEndTime = getUnitOffsetTime(unit, unit.reading.length)
        remainingToken = remainingToken.slice(availableReading.length)
        unitIndex += 1
        unitOffset = 0
        continue
      }

      return null
    }

    if (handledUnknownUnit)
      continue

    if (tokenStartTime == null || tokenEndTime == null)
      return null

    items.push({
      text: token,
      startTime: tokenStartTime,
      duration: Math.max(0, tokenEndTime - tokenStartTime),
    })
  }

  return items
}

function buildProportionalRomajiItems(baseLine: MusicLyricLine, tokens: string[], timedBaseItems: MusicLyricItem[]): MusicLyricItem[] {
  const lineStartTime = baseLine.startTime
  const lineDuration = baseLine.duration > 0
    ? baseLine.duration
    : timedBaseItems[timedBaseItems.length - 1].startTime + timedBaseItems[timedBaseItems.length - 1].duration - lineStartTime

  const tokenReadings = tokens.map(token => normalizeRomajiText(token))
  const totalReadingLength = tokenReadings.reduce((total, reading) => total + Math.max(1, reading.length), 0)
  let readingOffset = 0

  return tokens.map((token, index) => {
    const tokenReadingLength = Math.max(1, tokenReadings[index].length)
    const startRatio = readingOffset / totalReadingLength
    readingOffset += tokenReadingLength
    const endRatio = readingOffset / totalReadingLength
    const startTime = Math.round(lineStartTime + lineDuration * startRatio)
    const endTime = Math.round(lineStartTime + lineDuration * endRatio)

    return {
      text: token,
      startTime,
      duration: Math.max(0, endTime - startTime),
    }
  })
}

function buildIndexedRomajiItems(tokens: string[], timedBaseItems: MusicLyricItem[]): MusicLyricItem[] {
  return tokens.map((token, index) => {
    const startIndex = Math.floor(index * timedBaseItems.length / tokens.length)
    const endIndex = Math.max(startIndex, Math.floor((index + 1) * timedBaseItems.length / tokens.length) - 1)
    const startItem = timedBaseItems[startIndex]
    const endItem = timedBaseItems[endIndex]
    const startTime = startItem.startTime
    const endTime = endItem.startTime + endItem.duration

    return {
      text: token,
      startTime,
      duration: Math.max(0, endTime - startTime),
    }
  })
}

function inferTimedExtraLine(baseLine: MusicLyricLine, extraLine: MusicLyricLine): MusicLyricLine {
  if (extraLine.items.some(item => item.duration > 0))
    return extraLine

  const tokens = splitRomajiText(extraLine.originalText)
  const timedBaseItems = baseLine.items.filter(item => item.duration > 0)

  if (tokens.length === 0 || timedBaseItems.length === 0)
    return extraLine

  const unitBasedItems = buildUnitBasedRomajiItems(baseLine, tokens)
  if (unitBasedItems) {
    return {
      items: unitBasedItems,
      startTime: baseLine.startTime,
      duration: baseLine.duration,
      originalText: extraLine.originalText,
    }
  }

  if (tokens.length > timedBaseItems.length) {
    return {
      items: buildProportionalRomajiItems(baseLine, tokens, timedBaseItems),
      startTime: baseLine.startTime,
      duration: baseLine.duration,
      originalText: extraLine.originalText,
    }
  }

  return {
    items: buildIndexedRomajiItems(tokens, timedBaseItems),
    startTime: baseLine.startTime,
    duration: baseLine.duration,
    originalText: extraLine.originalText,
  }
}

function inferTimedExtraLines(baseLines: MusicLyricLine[], extraLines: MusicLyricLine[]): MusicLyricLine[] {
  if (baseLines.length === 0 || extraLines.length === 0)
    return extraLines

  return baseLines.map((baseLine) => {
    const extraLine = getExtraLyricLine(extraLines, baseLine.startTime)
    return extraLine ? inferTimedExtraLine(baseLine, extraLine) : null
  }).filter((line): line is MusicLyricLine => Boolean(line))
}

/** 翻译 / 音译行与主歌词行的最大时间差（毫秒）：超过时视为不属于任何一行 */
export const EXTRA_LYRIC_MAX_OFFSET_MS = 1000

/**
 * 把翻译 / 音译行挂到主歌词行上（宁缺勿错）：每行附加歌词最多挂到一行主歌词、每行主歌词最多挂一行附加歌词，
 * 按时间差从小到大配对，时间差超过 maxOffset 的不挂。挂上的附加行开始时间改为所属主行的开始时间，
 * 之后按开始时间精确查找即可（见 getExtraLyricLine）；没挂上的附加行丢弃，不用「最近一行」凑
 */
export function alignExtraLyricLines(baseLines: MusicLyricLine[], extraLines: MusicLyricLine[], maxOffset = EXTRA_LYRIC_MAX_OFFSET_MS): MusicLyricLine[] {
  const pairs: { offset: number, base: number, extra: number }[] = []
  extraLines.forEach((extraLine, extra) => {
    baseLines.forEach((baseLine, base) => {
      const offset = Math.abs(baseLine.startTime - extraLine.startTime)
      if (offset <= maxOffset)
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
    .map(([extra, base]) => ({ ...extraLines[extra], startTime: baseLines[base].startTime }))
    .sort((a, b) => a.startTime - b.startTime)
}

export function parseMusicLyrics(rawLyric: MusicLyrics | null): MusicLyricParseResult {
  const rawTranslationLines = parseExtraLyric(rawLyric?.ytlrc?.lyric?.trim() || rawLyric?.tlyric?.lyric?.trim())
  const rawRomajiLines = parseExtraLyric(rawLyric?.yromalrc?.lyric?.trim() || rawLyric?.romalrc?.lyric?.trim())
  const yrcText = rawLyric?.yrc?.lyric?.trim()
  if (yrcText) {
    const lines = parseYrc(yrcText)
    if (lines.length > 0) {
      return {
        sourceType: 'yrc',
        lines,
        translationLines: alignExtraLyricLines(lines, rawTranslationLines),
        romajiLines: inferTimedExtraLines(lines, alignExtraLyricLines(lines, rawRomajiLines)),
      }
    }
  }

  const lrcText = rawLyric?.lrc?.lyric?.trim()
  if (lrcText) {
    const lines = parseLrc(lrcText)
    if (lines.length > 0)
      return { sourceType: 'lrc', lines, translationLines: alignExtraLyricLines(lines, rawTranslationLines), romajiLines: alignExtraLyricLines(lines, rawRomajiLines) }
  }

  return { sourceType: 'none', lines: [], translationLines: [], romajiLines: [] }
}

/** QQ 音乐歌词（后端已解密并去掉 XML 外壳）：format 为 qrc（逐字）或 lrc；翻译为 LRC，音译与正文同格式 */
export interface QqLyricInput {
  format: string
  lyric: string
  translation: string
  romanization: string
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * 解析 QQ 音乐歌词，结构与网易云相同；翻译中的「//」表示这一行没有翻译，含中日韩文字的音译行多为说明文字，均不挂载
 */
export function parseQqLyrics(input: QqLyricInput | null): MusicLyricParseResult {
  const empty: MusicLyricParseResult = { sourceType: 'none', lines: [], translationLines: [], romajiLines: [] }
  const text = input?.lyric?.trim()
  if (!text)
    return empty
  const qrc = input!.format === 'qrc'
  const lines = qrc ? parseQrc(text) : parseLrc(text)
  if (lines.length === 0)
    return empty

  const parseExtra = (extra: string | undefined) => {
    const trimmed = extra?.trim()
    if (!trimmed)
      return []
    return sanitizeExtraLyricLines(/^\[\d+,\d+\]/m.test(trimmed) ? parseQrc(trimmed) : parseLrc(trimmed))
  }
  return {
    sourceType: qrc ? 'qrc' : 'lrc',
    lines,
    translationLines: alignExtraLyricLines(lines, parseExtra(input!.translation).filter(line => line.originalText !== '//')),
    romajiLines: alignExtraLyricLines(lines, parseExtra(input!.romanization).filter(line => !CJK_RE.test(line.originalText))),
  }
}

export function getCurrentLyricIndex(lines: MusicLyricLine[], currentTimeMs: number, previousIndex: number | null): number | null {
  if (lines.length === 0)
    return null

  let left = 0
  let right = lines.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const line = lines[mid]
    const nextLine = lines[mid + 1]
    const lineEndTime = line.duration > 0
      ? line.startTime + line.duration
      : (nextLine ? nextLine.startTime : Number.POSITIVE_INFINITY)

    if (currentTimeMs >= line.startTime && currentTimeMs < lineEndTime)
      return mid

    if (currentTimeMs < line.startTime)
      right = mid - 1
    else
      left = mid + 1
  }

  if (previousIndex != null) {
    const previousLine = lines[previousIndex]
    const nextLine = lines[previousIndex + 1]
    if (previousLine && currentTimeMs >= previousLine.startTime && (!nextLine || currentTimeMs < nextLine.startTime))
      return previousIndex
  }

  if (currentTimeMs < lines[0].startTime)
    return 0

  // 处于两行之间的空隙（逐字歌词的行有自身时长）时，停留在最近一个已开始的行；
  // 二分结束后 right 即为最后一个 startTime <= currentTimeMs 的行
  return Math.max(0, Math.min(right, lines.length - 1))
}

export function getCurrentWordIndex(line: MusicLyricLine | undefined, currentTimeMs: number): number | null {
  if (!line || line.items.length === 0)
    return null

  const index = line.items.findIndex(item => currentTimeMs < item.startTime + item.duration)
  if (index >= 0)
    return index

  return line.items.length - 1
}

export function getWordProgress(item: MusicLyricItem, currentTimeMs: number): number {
  if (item.duration <= 0)
    return currentTimeMs >= item.startTime ? 1 : 0

  return Math.max(0, Math.min(1, (currentTimeMs - item.startTime) / item.duration))
}

export function getExtraLyricText(lines: MusicLyricLine[], lineStartTime: number): string {
  return getExtraLyricLine(lines, lineStartTime)?.originalText ?? ''
}

/**
 * 取某行主歌词对应的翻译 / 音译行：附加歌词已在解析时按 alignExtraLyricLines 挂到主行上（开始时间与主行一致），
 * 这里只做精确查找；找不到说明这一行没有附加歌词，返回 null
 */
export function getExtraLyricLine(lines: MusicLyricLine[], lineStartTime: number): MusicLyricLine | null {
  return lines.find(line => line.startTime === lineStartTime) ?? null
}

/** 逐行歌词（LRC）在无法得知下一行时间时使用的默认行时长 */
export const LYRIC_MARQUEE_DEFAULT_LINE_DURATION_MS = 5000
/** 逐行歌词：行开始后先静止的比例，保证开头可读 */
export const LYRIC_MARQUEE_HOLD_RATIO = 0.1
/** 逐行歌词：滚动到末尾时所处的行进度比例，保证在行结束前完整露出结尾 */
export const LYRIC_MARQUEE_FINISH_RATIO = 0.88
/** 逐字歌词：当前演唱位置在可视区域中的锚点比例 */
export const LYRIC_MARQUEE_ANCHOR_RATIO = 0.65

/** 逐字歌词中每个字（词）在内容中的水平位置，单位 px，相对内容左边缘 */
export interface LyricMarqueeWordBox {
  left: number
  width: number
}

export interface LyricMarqueeOffsetParams {
  line: MusicLyricLine
  /** 下一行开始时间（ms），用于推算逐行歌词的行时长；最后一行传 undefined */
  nextLineStartTime?: number
  currentTimeMs: number
  /** 可视容器宽度（px） */
  containerWidth: number
  /** 内容总宽度（px） */
  contentWidth: number
  /** 逐字歌词各字的位置，长度需与 line.items 一致；不传或长度不符时按逐行处理 */
  wordBoxes?: LyricMarqueeWordBox[]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** 获取歌词行时长（ms）：优先使用行自身时长，其次为与下一行的间隔，最后回退默认值 */
export function getLyricLineDuration(line: MusicLyricLine, nextLineStartTime?: number): number {
  if (line.duration > 0)
    return line.duration
  if (nextLineStartTime != null && nextLineStartTime > line.startTime)
    return nextLineStartTime - line.startTime
  return LYRIC_MARQUEE_DEFAULT_LINE_DURATION_MS
}

/** 判断一行歌词是否带有逐字时间 */
export function isWordTimedLyricLine(line: MusicLyricLine): boolean {
  return line.items.some(item => item.duration > 0)
}

/**
 * 计算导航栏歌词跑马灯的水平偏移量（px，正值表示内容向左移动的距离），结果限定在 [0, 溢出宽度]
 * - 逐行歌词：先静止 HOLD_RATIO，再匀速滚动，在 FINISH_RATIO 时到达末尾
 * - 逐字歌词：在当前字的时间区间内线性插值演唱位置，使其保持在可视区域约 ANCHOR_RATIO 处
 */
export function getLyricMarqueeOffset({
  line,
  nextLineStartTime,
  currentTimeMs,
  containerWidth,
  contentWidth,
  wordBoxes,
}: LyricMarqueeOffsetParams): number {
  const overflow = contentWidth - containerWidth
  if (!(overflow > 0) || !Number.isFinite(overflow))
    return 0

  const items = line.items
  const useWordTiming = isWordTimedLyricLine(line) && wordBoxes != null && wordBoxes.length === items.length && items.length > 0

  if (!useWordTiming) {
    const lineDuration = getLyricLineDuration(line, nextLineStartTime)
    const progress = (currentTimeMs - line.startTime) / lineDuration
    const ratio = clamp((progress - LYRIC_MARQUEE_HOLD_RATIO) / (LYRIC_MARQUEE_FINISH_RATIO - LYRIC_MARQUEE_HOLD_RATIO), 0, 1)
    return ratio * overflow
  }

  // 找到当前游标所在区间：处于某个字的演唱区间内时线性插值，处于字间空隙时停在上一个字末尾
  let position = wordBoxes[0].left
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const box = wordBoxes[i]
    if (currentTimeMs < item.startTime) {
      position = i === 0 ? box.left : wordBoxes[i - 1].left + wordBoxes[i - 1].width
      break
    }
    const progress = getWordProgress(item, currentTimeMs)
    position = box.left + box.width * progress
    if (progress < 1)
      break
  }

  return clamp(position - containerWidth * LYRIC_MARQUEE_ANCHOR_RATIO, 0, overflow)
}
