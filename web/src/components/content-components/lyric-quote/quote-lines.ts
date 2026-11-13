import type { LyricLine, ResolvedLyrics } from '@/lib/lyrics/types'
import {
  alignTimedTexts,
  getLyricLineText,
  getLyricLineVocalStart,
  LYRIC_PLACEHOLDERS,
} from '@/lib/lyrics/line-utils'
import { alignLrcExtraToLines, parseLrcLines } from '@/lib/lyrics/parse-platform'

export interface QuoteLyrics {
  lines: LyricLine[]
  wordTimed: boolean
}

// 网易云歌词开头的署名行（作词 : xxx、Composer: xxx 等）不是歌词，不参与选句与展示
const CREDIT_LINE = /^\s*(?:作词|作曲|编曲|制作人|制作|监制|出品|发行|企划|和声|和音|混音|缩混|母带|录音|录音师|吉他|贝斯|鼓|键盘|钢琴|弦乐|人声编辑|配唱制作人|原唱|翻唱|OP|SP|lyrics?|lyricist|composer|composed by|written by|arranger|arranged by|producer|produced by|mixing engineer|mastering engineer|recording engineer)\s*[:：]/i

export function isLyricCreditLine(text: string): boolean {
  return CREDIT_LINE.test(text)
}

/** 过滤背景人声行、歌词接口返回的占位文本（no_lyric 等）与署名行 */
export function cleanLyricLines(lines: LyricLine[]): LyricLine[] {
  return lines.filter((line) => {
    if (line.isBackground)
      return false
    const text = getLyricLineText(line).trim()
    return Boolean(text) && !LYRIC_PLACEHOLDERS.has(text) && !isLyricCreditLine(text)
  })
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 文本快照按行拆分（选句时多句以换行连接） */
export function splitQuoteText(text: string): string[] {
  return text.split('\n').map(normalize).filter(Boolean)
}

/**
 * 按时间取引用范围内的歌词行：start 为起始句的开始时间（毫秒），end 为结束句（0 表示只引用起始句）；
 * 找不到完全一致的时间时取最后一个已开始的行，便于作者手填时间
 */
export function getQuoteLines(lines: LyricLine[], start: number, end: number): LyricLine[] {
  if (lines.length === 0)
    return []

  const findIndex = (time: number, exact = true) => {
    const found = lines.findIndex(line => Math.abs(getLyricLineVocalStart(line) - time) <= 350)
    if (found >= 0 || exact)
      return found
    let index = 0
    for (let i = 0; i < lines.length; i++) {
      if (getLyricLineVocalStart(lines[i]) <= time)
        index = i
    }
    return index
  }

  let startIndex = findIndex(start)
  if (startIndex < 0)
    startIndex = findIndex(start, false)
  const endIndex = end > 0 ? Math.max(startIndex, findIndex(end, false)) : startIndex
  return lines.slice(startIndex, endIndex + 1)
}

/**
 * 确定摘录展示的歌词行，以作者选句时保存的文本快照为准：
 * - 按时间取到的行与快照一致时直接使用
 * - 不一致时（在线歌词更新导致时间偏移等）按快照文本在歌词中重新定位，重复的段落取离原时间最近的一处
 * - 仍找不到时返回 null，只展示快照文本，避免悄悄换成别的句子
 * 没有快照（只填了时间的旧数据）时按时间取
 */
export function resolveQuoteLines(lines: LyricLine[], start: number, end: number, text: string): LyricLine[] | null {
  const byTime = getQuoteLines(lines, start, end)
  const wanted = splitQuoteText(text)
  if (wanted.length === 0)
    return byTime.length > 0 ? byTime : null

  const texts = lines.map(line => normalize(getLyricLineText(line)))
  const matchesAt = (index: number) => wanted.every((line, offset) => texts[index + offset] === line)
  const byTimeIndex = byTime.length > 0 ? lines.indexOf(byTime[0]) : -1
  if (byTime.length === wanted.length && byTimeIndex >= 0 && matchesAt(byTimeIndex))
    return byTime

  let best: number | null = null
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (matchesAt(i) && (best == null || Math.abs(getLyricLineVocalStart(lines[i]) - start) < Math.abs(getLyricLineVocalStart(lines[best]) - start)))
      best = i
  }
  return best == null ? null : lines.slice(best, best + wanted.length)
}

/** 片段的结束时间（毫秒）：最后一句的结束；只有文本快照时按作者选择的结束句估算 */
export function getSnippetEndMs(lines: LyricLine[], quoteLines: LyricLine[], start: number, end: number): number {
  const lastLine = quoteLines[quoteLines.length - 1]
  if (!lastLine)
    return Math.max(start, end) + 5000
  const lastStart = getLyricLineVocalStart(lastLine)
  if (lastLine.end > lastStart)
    return lastLine.end
  const nextLine = lines[lines.indexOf(lastLine) + 1]
  return nextLine ? getLyricLineVocalStart(nextLine) : lastStart + 5000
}

/**
 * 歌词摘录（展示与编辑器选句）使用的歌词：
 * - 作者手填的原歌词（LRC）优先，否则使用全站统一选出的在线歌词（与播放器、导航栏同一来源，见 contexts/song-lyrics.ts）
 * - 作者手填的翻译 / 发音覆盖在线数据；否则使用在线歌词的翻译 / 发音（原歌词为手填时按时间一对一挂到手填的行上）
 */
export function buildQuoteLyrics({ online, authorLyric, translation, romaji }: {
  online: ResolvedLyrics | null
  authorLyric: string
  translation: string
  romaji: string
}): QuoteLyrics {
  const authored = authorLyric.trim() !== ''
  const onlineVocalLines = (online?.lines ?? []).filter(line => !line.isBackground)
  const baseLines = cleanLyricLines(
    authored
      ? parseLrcLines(authorLyric)
      : onlineVocalLines.map((line) => {
          const vocalStart = getLyricLineVocalStart(line)
          return vocalStart === line.start ? line : { ...line, start: vocalStart }
        }),
  )

  const baseStarts = baseLines.map(line => getLyricLineVocalStart(line))
  const hasAuthorTranslation = translation.trim() !== ''
  const hasAuthorRomaji = romaji.trim() !== ''

  const translationMap = hasAuthorTranslation
    ? alignLrcExtraToLines(baseLines, translation)
    : authored
      ? alignTimedTexts(
          baseStarts,
          onlineVocalLines.flatMap(line => (line.translation ? [{ start: getLyricLineVocalStart(line), text: line.translation }] : [])),
        )
      : null

  const romajiMap = hasAuthorRomaji
    ? alignLrcExtraToLines(baseLines, romaji)
    : authored
      ? alignTimedTexts(
          baseStarts,
          onlineVocalLines.flatMap(line => (line.romanization ? [{ start: getLyricLineVocalStart(line), text: line.romanization }] : [])),
        )
      : null

  const lines = baseLines.map((line, index) => {
    const nextTranslation = translationMap ? translationMap.get(index) : line.translation
    const nextRomaji = romajiMap ? romajiMap.get(index) : line.romanization
    if (nextTranslation === line.translation && nextRomaji === line.romanization)
      return line
    return {
      ...line,
      translation: nextTranslation,
      romanization: nextRomaji,
    }
  })

  return {
    lines,
    wordTimed: !authored && Boolean(online?.wordTimed),
  }
}
