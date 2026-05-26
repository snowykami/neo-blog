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
  sourceType: 'yrc' | 'lrc' | 'none'
  lines: MusicLyricLine[]
  translationLines: MusicLyricLine[]
  romajiLines: MusicLyricLine[]
}

export type MusicLyricMode = 'none' | 'romaji' | 'translation'

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
    items: line.items.map(item => ({ ...item, text: item.text.replace(/〖|〗/g, '').trim() })),
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

function buildUnitBasedRomajiItems(baseLine: MusicLyricLine, tokens: string[]): MusicLyricItem[] | null {
  const units = createTimedRomajiUnits(baseLine)
  if (units.length === 0)
    return null

  const tokenParts = splitRomajiTokenParts(tokens)
  if (tokenParts.length === 0)
    return null

  const items: MusicLyricItem[] = []
  let unitIndex = 0
  let tokenIndex = 0

  while (unitIndex < units.length && tokenIndex < tokenParts.length) {
    const unit = units[unitIndex]
    const token = tokenParts[tokenIndex]
    const normalizedToken = normalizeRomajiText(token)

    if (!normalizedToken) {
      tokenIndex += 1
      continue
    }

    if (unit.reading && normalizedToken === unit.reading) {
      items.push({ text: token, startTime: unit.startTime, duration: unit.duration })
      unitIndex += 1
      tokenIndex += 1
      continue
    }

    if (unit.reading && normalizedToken.startsWith(unit.reading)) {
      items.push({ text: token, startTime: unit.startTime, duration: unit.duration })
      unitIndex += 1
      tokenIndex += 1
      continue
    }

    if (unit.reading && unit.reading.startsWith(normalizedToken)) {
      const groupStart = unitIndex
      let groupedReading = ''
      while (unitIndex < units.length && groupedReading.length < normalizedToken.length) {
        groupedReading += units[unitIndex].reading
        unitIndex += 1
      }
      const groupUnits = units.slice(groupStart, unitIndex)
      const startTime = groupUnits[0].startTime
      const endTime = groupUnits.reduce((end, currentUnit) => Math.max(end, currentUnit.startTime + currentUnit.duration), startTime)
      items.push({ text: token, startTime, duration: Math.max(0, endTime - startTime) })
      tokenIndex += 1
      continue
    }

    return null
  }

  if (tokenIndex !== tokenParts.length)
    return null

  return items
}

function buildEvenRomajiItems(baseLine: MusicLyricLine, tokens: string[], timedBaseItems: MusicLyricItem[]): MusicLyricItem[] {
  const lineDuration = baseLine.duration > 0
    ? baseLine.duration
    : timedBaseItems[timedBaseItems.length - 1].startTime + timedBaseItems[timedBaseItems.length - 1].duration - baseLine.startTime
  const tokenDuration = lineDuration / tokens.length
  return tokens.map((token, index) => ({
    text: token,
    startTime: Math.round(baseLine.startTime + tokenDuration * index),
    duration: Math.max(0, Math.round(tokenDuration)),
  }))
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
      items: buildEvenRomajiItems(baseLine, tokens, timedBaseItems),
      startTime: baseLine.startTime,
      duration: baseLine.duration,
      originalText: extraLine.originalText,
    }
  }

  const inferredItems = tokens.map((token, index) => {
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

  return {
    items: inferredItems,
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

export function parseMusicLyrics(rawLyric: MusicLyrics | null): MusicLyricParseResult {
  const translationLines = parseExtraLyric(rawLyric?.ytlrc?.lyric?.trim() || rawLyric?.tlyric?.lyric?.trim())
  const romajiLines = parseExtraLyric(rawLyric?.yromalrc?.lyric?.trim() || rawLyric?.romalrc?.lyric?.trim())
  const yrcText = rawLyric?.yrc?.lyric?.trim()
  if (yrcText) {
    const lines = parseYrc(yrcText)
    if (lines.length > 0)
      return { sourceType: 'yrc', lines, translationLines, romajiLines: inferTimedExtraLines(lines, romajiLines) }
  }

  const lrcText = rawLyric?.lrc?.lyric?.trim()
  if (lrcText) {
    const lines = parseLrc(lrcText)
    if (lines.length > 0)
      return { sourceType: 'lrc', lines, translationLines, romajiLines }
  }

  return { sourceType: 'none', lines: [], translationLines, romajiLines }
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

  return lines.length - 1
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

export function getExtraLyricLine(lines: MusicLyricLine[], lineStartTime: number): MusicLyricLine | null {
  if (lines.length === 0)
    return null

  const exactLine = lines.find(line => line.startTime === lineStartTime)
  if (exactLine)
    return exactLine

  const closestLine = lines.reduce((prev, curr) =>
    Math.abs(curr.startTime - lineStartTime) < Math.abs(prev.startTime - lineStartTime) ? curr : prev,
  )

  return closestLine
}
