import type { LyricLine } from './types'

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
  const lines = input
    .map(normalizeLine)
    .filter(line => line.words.some(word => word.text.trim() !== ''))
    .sort((a, b) => a.start - b.start)

  // 清洗重叠（按原始时间判断），同时截断上一行越过新结束时间的词
  for (let i = 0; i + 1 < lines.length; i++) {
    const end = trimUnintentionalOverlap(lines[i], lines[i + 1])
    if (end !== lines[i].end) {
      lines[i] = {
        ...lines[i],
        end,
        words: lines[i].words.map(word => ({ ...word, end: Math.min(word.end, end), start: Math.min(word.start, end) })),
      }
    }
  }

  // 提前起唱：基于清洗后的时间，不早于上一行的开始与 0。
  // 与上一行之间没有重叠时，最多提前到上一行结束为止（只用掉句间的空隙）：紧挨着的快歌短行若都提前 600ms，
  // 会被提前到同一时刻、同时高亮，焦点停在最早的一行，看起来像卡住
  return lines.map((line, i) => {
    const prev = lines[i - 1]
    const overlap = prev ? prev.end - line.start : 0
    const advance = overlap > 0
      ? (overlap >= EARLY_START_OVERLAP_MS ? EARLY_START_OVERLAP_MS : overlap * EARLY_START_OVERLAP_RATIO)
      : Math.min(EARLY_START_MS, prev ? -overlap : EARLY_START_MS)
    const start = Math.max(0, prev ? prev.start : 0, line.start - advance)
    return start === line.start ? line : { ...line, start }
  })
}
