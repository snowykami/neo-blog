import type { LyricLine } from './types'
import { LYRIC_INTERLUDE_MIN_GAP_MS } from './config'

/**
 * 歌词舞台上的条目：歌词行、间奏（相邻两行之间 ≥ 7 秒的空隙，以及前奏）与底栏。
 * 条目按显示顺序排列，焦点与滚动都以条目为单位
 */
export type TimelineItem
  = | { kind: 'line', line: number }
    | { kind: 'interlude', start: number, end: number }
    | { kind: 'footer' }

export function buildTimeline(lines: LyricLine[]): TimelineItem[] {
  const items: TimelineItem[] = []
  // 前奏足够长时同样显示间奏点
  if (lines.length > 0 && lines[0].start >= LYRIC_INTERLUDE_MIN_GAP_MS)
    items.push({ kind: 'interlude', start: 0, end: lines[0].start })
  lines.forEach((line, index) => {
    items.push({ kind: 'line', line: index })
    const next = lines[index + 1]
    if (next && next.start - line.end >= LYRIC_INTERLUDE_MIN_GAP_MS)
      items.push({ kind: 'interlude', start: line.end, end: next.start })
  })
  items.push({ kind: 'footer' })
  return items
}

export interface TimelineState {
  // 高亮的歌词行（行下标）：多行重叠时同时高亮；句间空隙内上一行保持高亮
  active: number[]
  // 焦点条目（条目下标）：滚动对齐的目标
  focus: number
  // 当前处于哪个间奏（条目下标），没有为 null
  interlude: number | null
}

/** 计算某一时刻的高亮行与焦点（见 spec 8.6、8.7） */
export function getTimelineState(lines: LyricLine[], items: TimelineItem[], timeMs: number): TimelineState {
  const itemOfLine = (line: number) => items.findIndex(item => item.kind === 'line' && item.line === line)
  const footer = items.length - 1

  const interlude = items.findIndex(item => item.kind === 'interlude' && timeMs >= item.start && timeMs < item.end)
  if (interlude >= 0)
    return { active: [], focus: interlude, interlude }

  if (lines.length === 0)
    return { active: [], focus: footer, interlude: null }
  if (timeMs < lines[0].start)
    return { active: [], focus: itemOfLine(0), interlude: null }

  const active: number[] = []
  lines.forEach((line, index) => {
    if (timeMs >= line.start && timeMs < line.end)
      active.push(index)
  })
  if (active.length > 0)
    return { active, focus: itemOfLine(active[0]), interlude: null }

  // 不在任何一行内：最后一行唱完后聚焦底栏；句间空隙内上一行保持高亮
  let previous = -1
  for (let i = 0; i < lines.length && lines[i].start <= timeMs; i++)
    previous = i
  if (previous === lines.length - 1)
    return { active: [], focus: footer, interlude: null }
  return { active: [previous], focus: itemOfLine(previous), interlude: null }
}

/**
 * 某一时刻正在唱（或句间短空隙里刚唱完）的那一句主唱行的文字，用于静态显示（如暂停时的顶栏灵动岛）；
 * 间奏（含前奏）、第一句开唱之前与最后一句唱完之后没有这一句，返回 null
 */
export function getLineTextAt(lines: LyricLine[], items: TimelineItem[], timeMs: number): string | null {
  const { focus, interlude } = getTimelineState(lines, items, timeMs)
  const item = items[focus]
  if (interlude != null || item?.kind !== 'line' || timeMs < lines[0].start)
    return null
  // 焦点是背景和声时取它前面最近的主唱行
  for (let i = item.line; i >= 0; i--) {
    if (!lines[i].isBackground)
      return lines[i].words.map(word => word.text).join('').trim() || null
  }
  return null
}

/** 某个词在 timeMs 时的演唱进度（0 ~ 1） */
export function getWordProgress(start: number, end: number, timeMs: number): number {
  if (end <= start)
    return timeMs >= start ? 1 : 0
  return Math.min(1, Math.max(0, (timeMs - start) / (end - start)))
}
