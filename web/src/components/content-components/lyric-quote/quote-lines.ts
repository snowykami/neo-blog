import type { SingleLineLyrics } from '@/lib/lyrics/from-platform'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { alignExtraLyricLines, LYRIC_PLACEHOLDERS, parseMusicLyrics } from '@/utils/music-lyric'

// 网易云歌词开头的署名行（作词 : xxx、Composer: xxx 等）不是歌词，不参与选句与展示
const CREDIT_LINE = /^\s*(?:作词|作曲|编曲|制作人|制作|监制|出品|发行|企划|和声|和音|混音|缩混|母带|录音|录音师|吉他|贝斯|鼓|键盘|钢琴|弦乐|人声编辑|配唱制作人|原唱|翻唱|OP|SP|lyrics?|lyricist|composer|composed by|written by|arranger|arranged by|producer|produced by|mixing engineer|mastering engineer|recording engineer)\s*[:：]/i

export function isLyricCreditLine(text: string): boolean {
  return CREDIT_LINE.test(text)
}

/** 过滤歌词接口返回的占位文本（no_lyric 等）与署名行 */
export function cleanLyricLines(lines: MusicLyricLine[]): MusicLyricLine[] {
  return lines.filter((line) => {
    const text = line.originalText.trim()
    return !LYRIC_PLACEHOLDERS.has(text) && !isLyricCreditLine(text)
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
export function getQuoteLines(lines: MusicLyricLine[], start: number, end: number): MusicLyricLine[] {
  if (lines.length === 0)
    return []

  const findIndex = (time: number, exact = true) => {
    const found = lines.findIndex(line => Math.abs(line.startTime - time) <= 350)
    if (found >= 0 || exact)
      return found
    let index = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startTime <= time)
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
export function resolveQuoteLines(lines: MusicLyricLine[], start: number, end: number, text: string): MusicLyricLine[] | null {
  const byTime = getQuoteLines(lines, start, end)
  const wanted = splitQuoteText(text)
  if (wanted.length === 0)
    return byTime.length > 0 ? byTime : null

  const texts = lines.map(line => normalize(line.originalText))
  const matchesAt = (index: number) => wanted.every((line, offset) => texts[index + offset] === line)
  const byTimeIndex = byTime.length > 0 ? lines.indexOf(byTime[0]) : -1
  if (byTime.length === wanted.length && byTimeIndex >= 0 && matchesAt(byTimeIndex))
    return byTime

  let best: number | null = null
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (matchesAt(i) && (best == null || Math.abs(lines[i].startTime - start) < Math.abs(lines[best].startTime - start)))
      best = i
  }
  return best == null ? null : lines.slice(best, best + wanted.length)
}

/** 片段的结束时间（毫秒）：最后一句的结束；只有文本快照时按作者选择的结束句估算 */
export function getSnippetEndMs(lines: MusicLyricLine[], quoteLines: MusicLyricLine[], start: number, end: number): number {
  const lastLine = quoteLines[quoteLines.length - 1]
  if (!lastLine)
    return Math.max(start, end) + 5000
  if (lastLine.duration > 0)
    return lastLine.startTime + lastLine.duration
  const nextLine = lines[lines.indexOf(lastLine) + 1]
  return nextLine?.startTime ?? lastLine.startTime + 5000
}

const parseLrcLines = (text: string) => (text.trim() ? parseMusicLyrics({ lrc: { lyric: text, version: 1 } }).lines : [])

/**
 * 歌词摘录（展示与编辑器选句）使用的歌词：
 * - 作者手填的原歌词（LRC）优先，否则使用全站统一选出的在线歌词（与播放器、导航栏同一来源，见 contexts/song-lyrics.ts）
 * - 作者手填的翻译 / 发音覆盖在线数据；否则使用在线歌词的翻译 / 发音（原歌词为手填时按时间一对一挂到手填的行上）
 */
export function buildQuoteLyrics({ online, authorLyric, translation, romaji }: {
  online: SingleLineLyrics | null
  authorLyric: string
  translation: string
  romaji: string
}): SingleLineLyrics {
  const authored = authorLyric.trim() !== ''
  const lines = cleanLyricLines(authored ? parseLrcLines(authorLyric) : online?.lines ?? [])
  const extra = (author: string, onlineLines: MusicLyricLine[]) => {
    if (author.trim())
      return alignExtraLyricLines(lines, cleanLyricLines(parseLrcLines(author)))
    return authored ? alignExtraLyricLines(lines, onlineLines) : onlineLines
  }
  return {
    lines,
    translationLines: extra(translation, online?.translationLines ?? []),
    romajiLines: extra(romaji, online?.romajiLines ?? []),
  }
}
