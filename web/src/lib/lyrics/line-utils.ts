import type { LyricAlign, LyricLine } from './types'

/** 没有歌词时歌词接口返回的占位文本，不应作为歌词展示 */
export const LYRIC_PLACEHOLDERS = new Set(['no_lyric', 'pure_music_without_lyric'])

/** 翻译 / 音译行与主歌词行的最大时间差（毫秒）：超过时视为不属于任何一行 */
export const EXTRA_LYRIC_MAX_OFFSET_MS = 1000

export interface TimedText {
  start: number
  text: string
}

/** 拼接一行歌词的完整原文 */
export function getLyricLineText(line: LyricLine): string {
  return line.words.map(word => word.text).join('').trim()
}

/**
 * 获取一行歌词的真实人声起唱时刻（毫秒）：
 * preprocessLyricLines 会将 LyricLine.start 最多提前 600ms 用于多行舞台预高亮，
 * 单行歌词、跑马灯、时间对齐与摘录选句需要取第一个词的真实开始时间
 */
export function getLyricLineVocalStart(line: LyricLine): number {
  return line.words[0]?.start ?? line.start
}

/** 过滤掉背景人声行，只保留主唱行 */
export function getVocalLyricLines(lines: LyricLine[]): LyricLine[] {
  return lines.filter(line => !line.isBackground)
}

/** 歌词行的对齐方向：未显式指定时按 isDuet 推导 */
export function getLyricLineAlign(line: Pick<LyricLine, 'align' | 'isDuet'>): LyricAlign {
  return line.align ?? (line.isDuet ? 'right' : 'left')
}

/**
 * 为每个背景人声行查找所属主唱行下标：
 * - backgroundPosition === 'above' 时优先向后寻找最近的主唱行，找不到再向前找
 * - 否则（below 或未标明位置）优先向前寻找最近的主唱行，找不到再向后找
 */
export function getBackgroundOwnerMap(lines: LyricLine[]): Map<number, number> {
  const owners = new Map<number, number>()
  const findForward = (from: number) => {
    for (let j = from + 1; j < lines.length; j++) {
      if (!lines[j].isBackground)
        return j
    }
    return -1
  }
  const findBackward = (from: number) => {
    for (let j = from - 1; j >= 0; j--) {
      if (!lines[j].isBackground)
        return j
    }
    return -1
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.isBackground)
      continue
    const owner = line.backgroundPosition === 'above'
      ? (findForward(i) >= 0 ? findForward(i) : findBackward(i))
      : (findBackward(i) >= 0 ? findBackward(i) : findForward(i))
    if (owner >= 0)
      owners.set(i, owner)
  }
  return owners
}

/**
 * 把翻译 / 音译行一对一挂到主歌词行上（宁缺勿错）：
 * 每行附加歌词最多挂到一行主歌词、每行主歌词最多挂一行附加歌词，按时间差从小到大配对，
 * 时间差超过 maxOffset 的不挂；返回 base 下标 -> 附加文本 的映射
 */
export function alignTimedTexts(
  baseStarts: number[],
  extras: TimedText[],
  maxOffset = EXTRA_LYRIC_MAX_OFFSET_MS,
): Map<number, string> {
  const pairs: { offset: number, base: number, extra: number }[] = []
  extras.forEach((extraItem, extra) => {
    baseStarts.forEach((baseStart, base) => {
      const offset = Math.abs(baseStart - extraItem.start)
      if (offset <= maxOffset)
        pairs.push({ offset, base, extra })
    })
  })
  pairs.sort((a, b) => a.offset - b.offset)

  const usedBase = new Set<number>()
  const usedExtra = new Set<number>()
  const result = new Map<number, string>()
  for (const { base, extra } of pairs) {
    if (usedBase.has(base) || usedExtra.has(extra))
      continue
    usedBase.add(base)
    usedExtra.add(extra)
    result.set(base, extras[extra].text)
  }
  return result
}

/**
 * 查找当前时刻所处的歌词行下标（基于真实人声起唱时刻二分查找）：
 * - 开唱前返回 0，两行之间的空隙停留在最近一个已开始的行
 */
export function findActiveLyricLineIndex(
  lines: LyricLine[],
  currentTimeMs: number,
  previousIndex: number | null = null,
): number | null {
  if (lines.length === 0)
    return null

  let left = 0
  let right = lines.length - 1
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const line = lines[mid]
    const nextLine = lines[mid + 1]
    const start = getLyricLineVocalStart(line)
    const lineEndTime = line.end > start
      ? line.end
      : (nextLine ? getLyricLineVocalStart(nextLine) : Number.POSITIVE_INFINITY)

    if (currentTimeMs >= start && currentTimeMs < lineEndTime)
      return mid

    if (currentTimeMs < start)
      right = mid - 1
    else
      left = mid + 1
  }

  if (previousIndex != null) {
    const previousLine = lines[previousIndex]
    const nextLine = lines[previousIndex + 1]
    if (
      previousLine
      && currentTimeMs >= getLyricLineVocalStart(previousLine)
      && (!nextLine || currentTimeMs < getLyricLineVocalStart(nextLine))
    ) {
      return previousIndex
    }
  }

  if (currentTimeMs < getLyricLineVocalStart(lines[0]))
    return 0

  return Math.max(0, Math.min(right, lines.length - 1))
}
