import type { LyricAgent, LyricAlign, LyricColor, ResolvedLyrics } from './types'
import { LYRIC_COLORS } from './colors'
import { getBackgroundOwnerMap, getLyricLineText } from './line-utils'
import { normalizeForMatch } from './strip-credits'

export interface SiteLyricSingerItem {
  id: string
  name: string
  role?: 'person' | 'group' | string
  color?: LyricColor | string
  align?: LyricAlign | string
  members?: string[]
}

export interface SiteLyricSingerLine {
  text: string
  occurrence: number
  bg?: boolean
  agent: string
}

export interface SiteLyricSingers {
  status: 'ready' | 'pending'
  stale?: boolean
  translationPending?: boolean
  source?: string
  singers: SiteLyricSingerItem[]
  translatedNames?: Record<string, string>
  lines: SiteLyricSingerLine[]
}

function isLyricColor(value?: string): value is LyricColor {
  return Boolean(value && value in LYRIC_COLORS)
}

function isLyricAlign(value?: string): value is LyricAlign {
  return value === 'left' || value === 'right' || value === 'center'
}

function formatSingerDisplayName(baseName?: string, translatedName?: string): string | undefined {
  const base = baseName?.trim()
  const tr = translatedName?.trim()
  if (!base)
    return tr || undefined
  if (!tr)
    return base
  const normBase = normalizeForMatch(base)
  const normTr = normalizeForMatch(tr)
  if (!normTr || normTr === normBase || normBase.includes(normTr))
    return base
  return `${base} (${tr})`
}

function sameAgentRecord(a?: Record<string, LyricAgent>, b?: Record<string, LyricAgent>): boolean {
  if (a === b)
    return true
  if (!a || !b)
    return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length)
    return false
  for (const key of keysA) {
    const left = a[key]
    const right = b[key]
    if (!right)
      return false
    if (
      left.id !== right.id
      || left.name !== right.name
      || left.color !== right.color
      || left.colorHex !== right.colorHex
      || left.isGroup !== right.isGroup
      || (left.members?.join('|') ?? '') !== (right.members?.join('|') ?? '')
    ) {
      return false
    }
  }
  return true
}

/**
 * 将独立演唱者/声部标注数据（TTML 多声部译名、LRC/YRC/QRC/KRC 的 AI 歌手分配）合并到已解析歌词中：
 * - 保留 TTML 原生 agents 的 colorHex / members 等属性，并在启用翻译时格式化为 `原名 (译名)`
 * - 为匹配到的歌词行补充 agent / align / isDuet，并让背景人声行沿用所属主唱行的对齐方向
 */
export function applyLyricSingers(
  lyrics: ResolvedLyrics,
  singersData: SiteLyricSingers | null,
  showTranslation = true,
): ResolvedLyrics {
  if (lyrics.source === 'none' || lyrics.lines.length === 0 || !singersData || singersData.status !== 'ready')
    return lyrics
  if (singersData.source && singersData.source !== lyrics.source)
    return lyrics

  const translatedNames = showTranslation ? singersData.translatedNames : undefined
  const nextAgents: Record<string, LyricAgent> = {}
  const alignByAgent = new Map<string, LyricAlign>()

  if (lyrics.agents) {
    for (const [id, existing] of Object.entries(lyrics.agents)) {
      const displayName = formatSingerDisplayName(existing.name, translatedNames?.[id])
      nextAgents[id] = displayName === existing.name
        ? existing
        : { ...existing, ...(displayName && { name: displayName }) }
    }
  }

  for (const item of singersData.singers) {
    if (!item.id)
      continue
    const existing = nextAgents[item.id] ?? lyrics.agents?.[item.id]
    const baseName = item.name?.trim() || existing?.name
    const displayName = formatSingerDisplayName(baseName, translatedNames?.[item.id])
    const isGroup = existing?.isGroup ?? (item.role === 'group' ? true : undefined)
    const color: LyricColor = existing?.color
      ?? (isLyricColor(item.color) ? item.color : (isGroup ? 'lavender' : 'sky'))
    const members = existing?.members ?? (item.members?.length ? item.members : undefined)

    nextAgents[item.id] = {
      id: item.id,
      ...(displayName && { name: displayName }),
      color,
      ...(existing?.colorHex && { colorHex: existing.colorHex }),
      ...(isGroup && { isGroup: true }),
      ...(members && { members }),
    }
    if (isLyricAlign(item.align))
      alignByAgent.set(item.id, item.align)
  }

  if (Object.keys(nextAgents).length === 0)
    return lyrics

  const lineLookup = new Map<string, string>()
  for (const line of singersData.lines) {
    if (!line.agent)
      continue
    lineLookup.set(`${Boolean(line.bg)}:${line.occurrence}:${normalizeForMatch(line.text)}`, line.agent)
  }

  const occCounts = new Map<string, number>()
  let linesChanged = false
  const nextLines = lyrics.lines.map((line) => {
    const bg = Boolean(line.isBackground)
    const norm = normalizeForMatch(getLyricLineText(line))
    const countKey = `${bg}:${norm}`
    const occ = occCounts.get(countKey) ?? 0
    occCounts.set(countKey, occ + 1)

    const matchedAgent = lineLookup.get(`${bg}:${occ}:${norm}`)
    const agentId = (matchedAgent && nextAgents[matchedAgent]) ? matchedAgent : line.agent
    if (!agentId || !nextAgents[agentId])
      return line

    if (bg) {
      if (line.agent === agentId)
        return line
      linesChanged = true
      return { ...line, agent: agentId }
    }

    const agentInfo = nextAgents[agentId]
    const explicitAlign = alignByAgent.get(agentId)
    const nextAlign: LyricAlign = agentInfo.isGroup
      ? (line.align === 'right' ? 'right' : (explicitAlign ?? 'center'))
      : (explicitAlign ?? line.align ?? 'left')
    const nextDuet = nextAlign === 'right'

    if (line.agent === agentId && line.align === nextAlign && line.isDuet === nextDuet)
      return line

    linesChanged = true
    return {
      ...line,
      agent: agentId,
      align: nextAlign,
      isDuet: nextDuet,
    }
  })

  if (singersData.lines.length > 0 && nextLines.some(line => line.isBackground)) {
    const ownerMap = getBackgroundOwnerMap(nextLines)
    for (let i = 0; i < nextLines.length; i++) {
      const line = nextLines[i]
      if (!line.isBackground)
        continue
      const ownerIdx = ownerMap.get(i)
      if (ownerIdx == null)
        continue
      const owner = nextLines[ownerIdx]
      const ownerAlign: LyricAlign = owner.align ?? 'left'
      const ownerDuet = ownerAlign === 'right'
      if (line.align !== ownerAlign || line.isDuet !== ownerDuet) {
        linesChanged = true
        nextLines[i] = { ...line, align: ownerAlign, isDuet: ownerDuet }
      }
    }
  }

  const agentsChanged = !sameAgentRecord(lyrics.agents, nextAgents)
  if (!agentsChanged && !linesChanged)
    return lyrics

  return {
    ...lyrics,
    agents: nextAgents,
    lines: linesChanged ? nextLines : lyrics.lines,
  }
}
