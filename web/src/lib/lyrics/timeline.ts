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

/** 某个词在 timeMs 时的演唱进度（0 ~ 1） */
export function getWordProgress(start: number, end: number, timeMs: number): number {
  if (end <= start)
    return timeMs >= start ? 1 : 0
  return Math.min(1, Math.max(0, (timeMs - start) / (end - start)))
}
