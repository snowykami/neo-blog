import type { MusicLyrics } from '@/api/music'

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
}

function parseLrc(lrcText: string): MusicLyricLine[] {
  const lines: MusicLyricLine[] = []
  const lineRegex = /\[(\d{2,3}):(\d{2})\.(\d{2,3})\](.*)/g

  let match = lineRegex.exec(lrcText)
  while (match !== null) {
    const [, minutes, seconds, ms, text] = match
    const startTime = (Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10)) * 1000 + Number.parseInt(ms.padEnd(3, '0').slice(0, 3), 10)
    const trimmedText = text.trim()

    if (!trimmedText)
      continue

    lines.push({
      items: [{ text: trimmedText, startTime, duration: 0 }],
      startTime,
      duration: 0,
      originalText: trimmedText,
    })
    match = lineRegex.exec(lrcText)
  }

  return lines.sort((a, b) => a.startTime - b.startTime)
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

export function parseMusicLyrics(rawLyric: MusicLyrics | null): MusicLyricParseResult {
  const yrcText = rawLyric?.yrc?.lyric?.trim()
  if (yrcText) {
    const lines = parseYrc(yrcText)
    if (lines.length > 0)
      return { sourceType: 'yrc', lines }
  }

  const lrcText = rawLyric?.lrc?.lyric?.trim()
  if (lrcText) {
    const lines = parseLrc(lrcText)
    if (lines.length > 0)
      return { sourceType: 'lrc', lines }
  }

  return { sourceType: 'none', lines: [] }
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
