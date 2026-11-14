import type { LyricLine } from './types'
import { getBackgroundOwnerMap } from './line-utils'

/**
 * 歌词预处理（见 spec 8.8）：解析后、渲染前统一执行
 * - 归一化连续空格，去掉行首行尾只有空白的词与没有文字的行
 * - 清洗无意重叠：重叠 ≥ 500ms 视为有意（合唱等）保留；不足 100ms 或不足下一行时长的 10% 视为无意，截断上一行
 * - 提前起唱：行的开始时间最多提前 600ms（且不早于上一行结束），便于在演唱前就把这一行滚到焦点；与上一行重叠时提前 400ms，
 *   重叠不足 400ms 时提前重叠时长的 70%。只调整行的开始时间，词的时间不变（逐字擦除仍按实际演唱时间）
 */

const INTENTIONAL_OVERLAP_MS = 500
const UNINTENTIONAL_OVERLAP_MS = 100
const UNINTENTIONAL_OVERLAP_RATIO = 0.1
const EARLY_START_MS = 600
const EARLY_START_OVERLAP_MS = 400
const EARLY_START_OVERLAP_RATIO = 0.7

function normalizeLine(line: LyricLine): LyricLine {
  // 只合并连续空白：拉丁文字的词间空格保存在词的首尾，不能 trim；行首、行尾只有空白的词去掉
  const words = line.words.map((word, index) => ({ word: { ...word, text: word.text.replace(/\s+/g, ' ') }, index })).filter(item => item.word.text !== '')
  let first = 0
  let last = words.length
  while (first < last && words[first].word.text === ' ')
    first++
  while (last > first && words[last - 1].word.text === ' ')
    last--
  const kept = words.slice(first, last)
  // 逐字音译按音节下标对应原文：去掉词后重新对应，对应的音节被去掉的段丢弃
  const remap = new Map(kept.map((item, i) => [item.index, i]))
  const romanizationWords = line.romanizationWords?.flatMap((part) => {
    const word = remap.get(part.word)
    return word == null ? [] : [{ ...part, word }]
  })
  return {
    ...line,
    words: kept.map(item => item.word),
    translation: line.translation?.replace(/\s+/g, ' ').trim() || undefined,
    romanization: line.romanization?.replace(/\s+/g, ' ').trim() || undefined,
    romanizationWords: romanizationWords?.length ? romanizationWords : undefined,
  }
}

/** 清洗无意重叠：返回上一行应当截断到的结束时间（不截断时原样返回） */
function trimUnintentionalOverlap(prev: LyricLine, next: LyricLine): number {
  const overlap = prev.end - next.start
  if (overlap <= 0 || overlap >= INTENTIONAL_OVERLAP_MS)
    return prev.end
  const nextDuration = Math.max(0, next.end - next.start)
  if (overlap < UNINTENTIONAL_OVERLAP_MS || overlap < nextDuration * UNINTENTIONAL_OVERLAP_RATIO)
    return next.start
  return prev.end
}

export function preprocessLyricLines(input: LyricLine[]): LyricLine[] {
  const ownerMap = getBackgroundOwnerMap(input)
  const normalized = input.map(normalizeLine)
  const isNonEmpty = (line: LyricLine) => line.words.some(word => word.text.trim() !== '')

  interface LineGroup {
    main: LyricLine
    above: LyricLine[]
    below: LyricLine[]
  }

  const groupByIndex = new Map<number, LineGroup>()
  const groups: LineGroup[] = []
  let paragraphPending = false

  for (let i = 0; i < normalized.length; i++) {
    if (input[i].isBackground)
      continue
    if (!isNonEmpty(normalized[i])) {
      if (input[i].paragraphStart)
        paragraphPending = true
      continue
    }
    const main = paragraphPending && !normalized[i].paragraphStart
      ? { ...normalized[i], paragraphStart: true }
      : normalized[i]
    paragraphPending = false
    const group: LineGroup = { main, above: [], below: [] }
    groupByIndex.set(i, group)
    groups.push(group)
  }

  // 极端兜底：全曲没有主唱行时只做归一化与空行过滤
  if (groups.length === 0)
    return normalized.filter(isNonEmpty)

  for (let i = 0; i < normalized.length; i++) {
    if (!input[i].isBackground || !isNonEmpty(normalized[i]))
      continue
    const ownerIdx = ownerMap.get(i)
    const group = ownerIdx != null ? groupByIndex.get(ownerIdx) : undefined
    if (!group)
      continue
    const isAbove = input[i].backgroundPosition === 'above' || (input[i].backgroundPosition == null && ownerIdx != null && i < ownerIdx)
    const canInheritOwnerAlign = input[i].align == null && (!input[i].agent || input[i].agent === group.main.agent)
    const inheritedAlign = canInheritOwnerAlign && group.main.align != null
      ? { align: group.main.align, isDuet: group.main.isDuet }
      : (canInheritOwnerAlign && group.main.isDuet ? { isDuet: true } : {})
    const bgLine: LyricLine = {
      ...normalized[i],
      ...inheritedAlign,
      backgroundPosition: isAbove ? 'above' : 'below',
    }
    if (isAbove)
      group.above.push(bgLine)
    else
      group.below.push(bgLine)
  }

  groups.sort((a, b) => a.main.start - b.main.start)
  // 首段第一句主唱行上方不留段落间距（同 StarryPlayer LyricsView 首行规则，含前奏间奏之后）
  if (groups[0].main.paragraphStart) {
    const { paragraphStart: _, ...firstMain } = groups[0].main
    groups[0].main = firstMain
  }

  // 清洗重叠（只针对相邻主唱行按原始时间判断，不与背景行互裁），同时截断越过新结束时间的词
  for (let i = 0; i + 1 < groups.length; i++) {
    const cur = groups[i].main
    const next = groups[i + 1].main
    const end = trimUnintentionalOverlap(cur, next)
    if (end !== cur.end) {
      groups[i].main = {
        ...cur,
        end,
        words: cur.words.map(word => ({
          ...word,
          end: Math.min(word.end, end),
          start: Math.min(word.start, end),
          ...(word.ruby && {
            ruby: word.ruby.map(r => ({
              ...r,
              start: Math.min(r.start, end),
              end: Math.min(r.end, end),
            })),
          }),
        })),
      }
    }
  }

  // 提前起唱：仅在主唱行序列上推进，不早于上一主唱行的开始与 0，且绝不提前抢占上一句尚未唱完的后置背景人声（同 StarryPlayer releaseTime）
  for (let i = 0; i < groups.length; i++) {
    const cur = groups[i].main
    const prevGroup = i > 0 ? groups[i - 1] : undefined
    const prev = prevGroup?.main
    const prevGroupEnd = prevGroup
      ? Math.max(prevGroup.main.end, ...prevGroup.above.map(b => b.end), ...prevGroup.below.map(b => b.end))
      : 0
    const mainOverlap = prev ? prev.end - cur.start : 0
    let advance: number
    if (mainOverlap > 0) {
      advance = mainOverlap >= EARLY_START_OVERLAP_MS ? EARLY_START_OVERLAP_MS : mainOverlap * EARLY_START_OVERLAP_RATIO
    }
    else if (prev) {
      const freeGap = cur.start - prevGroupEnd
      advance = freeGap > 0 ? Math.min(EARLY_START_MS, freeGap) : 0
    }
    else {
      advance = EARLY_START_MS
    }
    const start = Math.max(0, prev ? prev.start : 0, cur.start - advance)
    if (start !== cur.start)
      groups[i].main = { ...cur, start }
  }

  return groups.flatMap(group => [...group.above, group.main, ...group.below])
}
