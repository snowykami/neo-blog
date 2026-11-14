import type { LyricLine } from './types'
import { LYRIC_INTERLUDE_DELAY_MS, LYRIC_INTERLUDE_MIN_GAP_MS } from './config'
import { getBackgroundOwnerMap, getLyricLineVocalStart } from './line-utils'

/**
 * 歌词舞台上的条目：歌词行、间奏（相邻主唱行组之间 ≥ 7 秒的空隙，以及前奏）与底栏。
 * 条目按显示顺序排列，焦点与滚动都以条目为单位
 */
export type TimelineItem
  = | { kind: 'line', line: number }
    | { kind: 'interlude', start: number, end: number }
    | { kind: 'footer' }

interface MainGroup {
  main: number
  members: number[]
  lastLineIndex: number
  groupStart: number
  groupVocalStart: number
  groupEnd: number
}

function buildMainGroups(lines: LyricLine[], owners: Map<number, number>): MainGroup[] {
  const attached = new Map<number, number[]>()
  for (const [bg, owner] of owners) {
    const list = attached.get(owner) ?? []
    list.push(bg)
    attached.set(owner, list)
  }
  const groups: MainGroup[] = []
  lines.forEach((line, index) => {
    if (line.isBackground)
      return
    const members = [index, ...(attached.get(index) ?? [])].sort((a, b) => a - b)
    groups.push({
      main: index,
      members,
      lastLineIndex: members[members.length - 1],
      groupStart: Math.min(...members.map(i => lines[i].start)),
      groupVocalStart: Math.min(...members.map(i => getLyricLineVocalStart(lines[i]))),
      groupEnd: Math.max(...members.map(i => lines[i].end)),
    })
  })
  return groups
}

export function buildTimeline(lines: LyricLine[]): TimelineItem[] {
  const items: TimelineItem[] = []
  if (lines.length === 0) {
    items.push({ kind: 'footer' })
    return items
  }
  const owners = getBackgroundOwnerMap(lines)
  const groups = buildMainGroups(lines, owners)
  if (groups.length === 0) {
    // 兜底：全是背景行时沿用真实起唱判断
    if (getLyricLineVocalStart(lines[0]) >= LYRIC_INTERLUDE_MIN_GAP_MS && lines[0].start > 0)
      items.push({ kind: 'interlude', start: 0, end: lines[0].start })
    lines.forEach((line, index) => {
      items.push({ kind: 'line', line: index })
      const next = lines[index + 1]
      if (next && getLyricLineVocalStart(next) - line.end >= LYRIC_INTERLUDE_MIN_GAP_MS && next.start > line.end + LYRIC_INTERLUDE_DELAY_MS)
        items.push({ kind: 'interlude', start: line.end + LYRIC_INTERLUDE_DELAY_MS, end: next.start })
    })
    items.push({ kind: 'footer' })
    return items
  }

  // 前奏足够长（按真实人声起唱时刻判满 7s）时显示间奏点
  if (groups[0].groupVocalStart >= LYRIC_INTERLUDE_MIN_GAP_MS && groups[0].groupStart > 0)
    items.push({ kind: 'interlude', start: 0, end: groups[0].groupStart })

  const groupIndexByLastLine = new Map<number, number>()
  groups.forEach((group, gi) => groupIndexByLastLine.set(group.lastLineIndex, gi))

  lines.forEach((_, index) => {
    items.push({ kind: 'line', line: index })
    const gi = groupIndexByLastLine.get(index)
    if (gi == null)
      return
    const cur = groups[gi]
    const next = groups[gi + 1]
    // 按下一组真实人声起唱时刻与上一组结束时刻的空隙判满 7s，并在句末延后 100ms 进入间奏
    if (next && next.groupVocalStart - cur.groupEnd >= LYRIC_INTERLUDE_MIN_GAP_MS) {
      const start = cur.groupEnd + LYRIC_INTERLUDE_DELAY_MS
      if (next.groupStart > start)
        items.push({ kind: 'interlude', start, end: next.groupStart })
    }
  })

  items.push({ kind: 'footer' })
  return items
}

export interface TimelineState {
  // 高亮的歌词行（行下标）：多行重叠或背景人声演唱时主行保持高亮；句间空隙内上一行保持高亮
  active: number[]
  // 焦点条目（条目下标）：滚动对齐的目标，始终锁定在主唱行（或间奏 / 底栏）
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

  const owners = getBackgroundOwnerMap(lines)
  const groups = buildMainGroups(lines, owners)
  const earliestStart = Math.min(...lines.map(line => line.start))
  const firstFocusLine = groups[0]?.main ?? 0

  if (timeMs < earliestStart)
    return { active: [], focus: itemOfLine(firstFocusLine), interlude: null }

  const directActive: number[] = []
  lines.forEach((line, index) => {
    if (timeMs >= line.start && timeMs < line.end)
      directActive.push(index)
  })
  if (directActive.length > 0) {
    const activeSet = new Set(directActive)
    for (const index of directActive) {
      if (lines[index].isBackground) {
        const owner = owners.get(index)
        if (owner != null)
          activeSet.add(owner)
      }
    }
    const active = Array.from(activeSet).sort((a, b) => a - b)
    // 焦点始终指向当前活跃的主唱行：优先正在唱的第一句主唱行，仅有背景人声在唱时锁定其所属主唱行
    const firstMainActive = directActive.find(index => !lines[index].isBackground)
    const focusLine = firstMainActive ?? owners.get(directActive[0]) ?? active[0]
    return { active, focus: itemOfLine(focusLine), interlude: null }
  }

  // 不在任何一行内：最后一组唱完后聚焦底栏；句间空隙内上一主唱行保持高亮
  if (groups.length === 0) {
    let previous = -1
    for (let i = 0; i < lines.length && lines[i].start <= timeMs; i++)
      previous = i
    if (previous === lines.length - 1)
      return { active: [], focus: footer, interlude: null }
    return { active: [previous], focus: itemOfLine(previous), interlude: null }
  }

  let previousGroup = groups[0]
  for (const group of groups) {
    if (group.groupStart <= timeMs)
      previousGroup = group
    else
      break
  }
  const lastGroup = groups[groups.length - 1]
  if (previousGroup === lastGroup && timeMs >= lastGroup.groupEnd)
    return { active: [], focus: footer, interlude: null }
  return { active: [previousGroup.main], focus: itemOfLine(previousGroup.main), interlude: null }
}

/**
 * 某一时刻正在唱（或句间短空隙里刚唱完）的那一句主唱行的文字，用于静态显示（如暂停时的顶栏灵动岛）；
 * 间奏（含前奏）、第一句开唱之前与最后一句唱完之后没有这一句，返回 null
 */
export function getLineTextAt(lines: LyricLine[], items: TimelineItem[], timeMs: number): string | null {
  const { focus, interlude } = getTimelineState(lines, items, timeMs)
  const item = items[focus]
  const earliestStart = lines.length > 0 ? Math.min(...lines.map(line => line.start)) : 0
  if (interlude != null || item?.kind !== 'line' || timeMs < earliestStart)
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
