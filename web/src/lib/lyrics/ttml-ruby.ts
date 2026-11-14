import type { LyricRuby, LyricWord } from './types'

/**
 * TTML 振假名（ruby）与占位时间解析辅助：
 * - 兼容 W3C TTML2 <span tts:ruby="container">（含 StarryPlayer 导出的无外层时间 .amll 容器，以及 base/text 内嵌子 <span> 时间的 .ttml2 容器）
 * - 兼容 StarryPlayer / AMLL 跨音节共享注音扩展属性（ttx:rubyGroup / ttx:rubyText / ttx:rubyTimes）
 * - 兼容 00:00.000 连续占位音节的单调不重叠均分回填
 */

export interface SharedRubyMark {
  id: string
  text?: string | null
  times?: string | null
}

export interface TtmlWordDraft extends LyricWord {
  placeholder?: boolean
  rubyGroup?: SharedRubyMark
}

export function splitRubyGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl)
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
  return Array.from(text)
}

/** 按各段字符数权重把 [start, end] 顺序分配给多段注音文本 */
export function spreadRubyTexts(texts: string[], start: number, end: number): LyricRuby[] {
  if (texts.length === 0)
    return []
  const weights = texts.map((text) => {
    const visible = splitRubyGraphemes(text.trim()).length
    return Math.max(1, visible)
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const duration = Math.max(0, end - start)
  let used = 0
  return texts.map((text, index) => {
    const pieceStart = Math.round(start + duration * used / total)
    used += weights[index]
    const pieceEnd = Math.round(start + duration * used / total)
    return { text, start: pieceStart, end: Math.max(pieceStart, pieceEnd) }
  })
}

/**
 * 解码 ttx:rubyText：以未转义的 `|` 分隔注音段，支持 `\|` 与 `\\` 转义；
 * 段尾若有空格（如英文注音 `eternal |love`）保留单个词间空格，末段去尾空白；含空段时返回 null
 */
export function decodeSharedRubyText(raw: string): string[] | null {
  const rawPieces: string[] = []
  let current = ''
  let escaped = false
  for (const ch of raw) {
    if (escaped) {
      current += ch
      escaped = false
    }
    else if (ch === '\\') {
      escaped = true
    }
    else if (ch === '|') {
      rawPieces.push(current)
      current = ''
    }
    else {
      current += ch
    }
  }
  rawPieces.push(current)
  if (rawPieces.some(piece => piece.trim() === ''))
    return null

  const cleaned = rawPieces.map((piece) => {
    const normalized = piece.replace(/[\r\n]/g, ' ')
    const body = normalized.trim()
    return /\s$/.test(normalized) ? `${body} ` : body
  })
  if (cleaned.length > 0)
    cleaned[cleaned.length - 1] = cleaned[cleaned.length - 1].trim()
  return cleaned.length > 0 ? cleaned : null
}

/** 解码 ttx:rubyTimes：以空白分隔 `begin,end` 时间对，任一非法或 end < start 时返回 null */
export function decodeSharedRubyTimes(
  raw: string,
  parseTime: (value: string | null) => number | null,
): { start: number, end: number }[] | null {
  const pairs = raw.trim().split(/\s+/).filter(Boolean)
  if (pairs.length === 0)
    return null
  const result: { start: number, end: number }[] = []
  for (const pair of pairs) {
    const parts = pair.split(',')
    if (parts.length !== 2)
      return null
    const start = parseTime(parts[0])
    const end = parseTime(parts[1])
    if (start == null || end == null || end < start)
      return null
    result.push({ start, end })
  }
  return result
}

interface TimedPiece {
  text: string
  start: number | null
  end: number | null
}

function collectNestedPieces(
  el: Element,
  attr: (node: Element, localName: string) => string | null,
  parseTime: (value: string | null) => number | null,
  preserveTrailingSpace: boolean,
): TimedPiece[] {
  const directStart = parseTime(attr(el, 'begin'))
  const directEnd = parseTime(attr(el, 'end'))
  const childSpans = Array.from(el.children).filter(child => (child.localName ?? child.tagName).split(':').pop() === 'span')
  if (childSpans.length > 0 && directStart == null && directEnd == null) {
    const pieces: TimedPiece[] = []
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        const raw = node.textContent ?? ''
        if (/^\s+$/.test(raw)) {
          if (preserveTrailingSpace && pieces.length > 0 && !pieces[pieces.length - 1].text.endsWith(' '))
            pieces[pieces.length - 1].text += ' '
        }
        else if (raw) {
          pieces.push({ text: raw, start: null, end: null })
        }
        continue
      }
      if (node.nodeType !== 1)
        continue
      const child = node as Element
      if ((child.localName ?? child.tagName).split(':').pop() !== 'span')
        continue
      const rubyRole = attr(child, 'ruby')
      if (rubyRole === 'delimiter')
        continue
      const rawText = child.textContent?.replace(/[\r\n]+/g, ' ') ?? ''
      const trimmed = rawText.trim()
      if (!trimmed)
        continue
      const text = preserveTrailingSpace && /\s$/.test(rawText) ? `${trimmed} ` : trimmed
      pieces.push({
        text,
        start: parseTime(attr(child, 'begin')),
        end: parseTime(attr(child, 'end')),
      })
    }
    if (preserveTrailingSpace && pieces.length > 0)
      pieces[pieces.length - 1].text = pieces[pieces.length - 1].text.trimEnd()
    if (pieces.length > 0)
      return pieces
  }
  const rawText = el.textContent?.replace(/[\r\n]+/g, ' ') ?? ''
  const trimmed = preserveTrailingSpace ? rawText.trim() : rawText.replace(/\s+/g, ' ').trim()
  if (!trimmed)
    return []
  return [{ text: trimmed, start: directStart, end: directEnd }]
}

/**
 * 解析 <span tts:ruby="container">：
 * - 支持 base / text 直接带时间，或内嵌子 <span> 带时间（StarryPlayer .ttml2 多音节振假名）
 * - 支持 container 与 base 省略时间、仅在 ruby text 上标注起止时间（StarryPlayer .amll 默认导出）
 */
export function parseTtmlRubyContainer(
  container: Element,
  attr: (node: Element, localName: string) => string | null,
  parseTime: (value: string | null) => number | null,
  extractBaseText: (node: Node) => string,
): { text: string, start: number | null, end: number | null, ruby?: LyricRuby[] } {
  const allSpans = Array.from(container.getElementsByTagName('*')).filter(child => (child.localName ?? child.tagName).split(':').pop() === 'span')
  const baseEls = allSpans.filter(el => attr(el, 'ruby') === 'base')
  const textEls = allSpans.filter(el => attr(el, 'ruby') === 'text')

  const basePieces = baseEls.flatMap(el => collectNestedPieces(el, attr, parseTime, true))
  const baseText = baseEls.length > 0
    ? basePieces.map(piece => piece.text).join('')
    : extractBaseText(container)

  const rubyPieces = textEls.flatMap(el => collectNestedPieces(el, attr, parseTime, true))
  if (rubyPieces.length > 0)
    rubyPieces[rubyPieces.length - 1].text = rubyPieces[rubyPieces.length - 1].text.trimEnd()

  const baseStarts = basePieces.map(piece => piece.start).filter((v): v is number => v != null)
  const baseEnds = basePieces.map(piece => piece.end ?? piece.start).filter((v): v is number => v != null)
  const rubyStarts = rubyPieces.map(piece => piece.start).filter((v): v is number => v != null)
  const rubyEnds = rubyPieces.map(piece => piece.end ?? piece.start).filter((v): v is number => v != null)

  const containerStart = parseTime(attr(container, 'begin'))
  const containerEnd = parseTime(attr(container, 'end'))

  const start = baseStarts.length > 0
    ? Math.min(...baseStarts)
    : containerStart ?? (rubyStarts.length > 0 ? Math.min(...rubyStarts) : null)
  const end = baseEnds.length > 0
    ? Math.max(...baseEnds)
    : containerEnd ?? (rubyEnds.length > 0 ? Math.max(...rubyEnds) : null)

  const rubies: LyricRuby[] = []
  if (rubyPieces.length > 0 && start != null && end != null) {
    const wordStart = start
    const wordEnd = Math.max(start, end)
    const allTimed = rubyPieces.every(piece => piece.start != null)
      && (wordStart <= 0 || rubyPieces.some(piece => (piece.start ?? 0) > 0 || (piece.end ?? 0) > 0))
    if (allTimed) {
      for (const piece of rubyPieces) {
        const s = Math.min(Math.max(piece.start!, wordStart), wordEnd)
        const e = Math.min(Math.max(piece.end ?? s, s), wordEnd)
        rubies.push({ text: piece.text, start: s, end: e })
      }
    }
    else {
      // 未完整带时间的注音：单段且不含词间空格时拆为逐假名，按字符数平分音节时长
      const expanded = rubyPieces.length === 1 && !/\s/.test(rubyPieces[0].text)
        ? splitRubyGraphemes(rubyPieces[0].text).filter(ch => ch.trim() !== '')
        : rubyPieces.map(piece => piece.text)
      rubies.push(...spreadRubyTexts(expanded, wordStart, wordEnd))
    }
  }

  return {
    text: baseText,
    start,
    end,
    ...(rubies.length > 0 && { ruby: rubies }),
  }
}

/**
 * 回填一行中的 00:00.000 占位音节（参考 StarryPlayer retimePlaceholders）：
 * - 连续占位段以后一个真实音节的开始为终点、每个占位取后一个音节的时长，但绝不早于前一个真实音节的结束（保证单调不重叠）
 * - 位于行尾时接在前一个音节之后；全行都是占位时均分 [fallbackStart, fallbackEnd]
 */
export function retimePlaceholderWords(
  words: TtmlWordDraft[],
  fallbackStart: number,
  fallbackEnd: number,
): TtmlWordDraft[] {
  if (words.length === 0)
    return words
  const isPlaceholderAt = (index: number): boolean => {
    const word = words[index]
    if (word.placeholder)
      return true
    if (word.start > 0)
      return false
    if (word.end <= 0 || fallbackStart > 0)
      return true
    for (let k = 0; k < index; k++) {
      if (words[k].end > 0)
        return true
    }
    return false
  }

  const placeholders = new Set<number>()
  for (let i = 0; i < words.length; i++) {
    if (isPlaceholderAt(i))
      placeholders.add(i)
  }
  if (placeholders.size === 0)
    return words

  const result = words.map(word => ({ ...word }))
  let i = 0
  while (i < result.length) {
    if (!placeholders.has(i)) {
      i++
      continue
    }
    let j = i
    while (j < result.length && placeholders.has(j))
      j++
    const count = j - i
    const prev = i > 0 ? result[i - 1] : undefined
    let runStart: number
    let runEnd: number
    if (j < result.length) {
      const next = result[j]
      const nextDur = Math.max(0, next.end - next.start)
      const floor = prev ? prev.end : fallbackStart
      runEnd = Math.max(next.start, floor)
      runStart = Math.min(runEnd, Math.max(floor, runEnd - count * nextDur))
    }
    else if (prev) {
      const prevDur = Math.max(0, prev.end - prev.start)
      runStart = prev.end
      runEnd = runStart + count * prevDur
    }
    else {
      runStart = fallbackStart
      runEnd = Math.max(fallbackStart, fallbackEnd)
    }
    const step = (runEnd - runStart) / count
    for (let k = i; k < j; k++) {
      const s = Math.round(runStart + (k - i) * step)
      const e = Math.round(runStart + (k - i + 1) * step)
      const cur = result[k]
      result[k] = {
        ...cur,
        start: s,
        end: Math.max(s, e),
        ...(cur.ruby?.length ? { ruby: spreadRubyTexts(cur.ruby.map(item => item.text), s, Math.max(s, e)) } : {}),
      }
    }
    i = j
  }
  return result
}

/**
 * 解析并合并行内的 ttx:rubyGroup 跨音节共享振假名：
 * - 同一组 ID 在同一声部内只允许出现一段连续音节，首音节携带 ttx:rubyText（及可选 ttx:rubyTimes），后续成员不重复携带
 * - 合并为一个带 ruby 的 LyricWord，注音时间钳制在整组 [start, end] 范围内，避免跨音节熟字训（如「今 + 日 → きょう」「明 + 日 → あした」）丢失振假名
 */
export function applySharedRubyGroups(
  words: TtmlWordDraft[],
  parseTime: (value: string | null) => number | null,
): LyricWord[] {
  const stripDraft = ({ placeholder: _p, rubyGroup: _g, ...clean }: TtmlWordDraft): LyricWord => clean
  if (!words.some(word => word.rubyGroup))
    return words.map(stripDraft)

  interface Run {
    id: string
    from: number
    to: number
  }
  const runs: Run[] = []
  words.forEach((word, index) => {
    const id = word.rubyGroup?.id
    if (!id)
      return
    const prev = runs.at(-1)
    // 相邻音节若前一个末尾带有词间空格，仅当仍属同一 rubyGroup 连续段时合并文本
    if (prev && prev.id === id && prev.to === index - 1)
      prev.to = index
    else
      runs.push({ id, from: index, to: index })
  })

  const idCounts = new Map<string, number>()
  for (const run of runs)
    idCounts.set(run.id, (idCounts.get(run.id) ?? 0) + 1)

  const validRuns = new Map<number, { to: number, ruby: LyricRuby[] }>()
  for (const run of runs) {
    if (idCounts.get(run.id) !== 1)
      continue
    const leadMark = words[run.from].rubyGroup
    if (!leadMark?.text)
      continue
    let trailingClean = true
    for (let k = run.from + 1; k <= run.to; k++) {
      if (words[k].rubyGroup?.text || words[k].rubyGroup?.times) {
        trailingClean = false
        break
      }
    }
    if (!trailingClean)
      continue
    const pieces = decodeSharedRubyText(leadMark.text)
    if (!pieces)
      continue
    const groupStart = words[run.from].start
    const groupEnd = Math.max(groupStart, words[run.to].end)
    let ruby = spreadRubyTexts(pieces, groupStart, groupEnd)
    if (leadMark.times != null) {
      const decodedTimes = decodeSharedRubyTimes(leadMark.times, parseTime)
      if (!decodedTimes || decodedTimes.length !== pieces.length)
        continue
      if (decodedTimes.some(item => item.end > 0) || groupStart <= 0) {
        ruby = pieces.map((text, idx) => {
          const s = Math.min(Math.max(decodedTimes[idx].start, groupStart), groupEnd)
          const e = Math.min(Math.max(decodedTimes[idx].end, s), groupEnd)
          return { text, start: s, end: e }
        })
      }
    }
    validRuns.set(run.from, { to: run.to, ruby })
  }

  if (validRuns.size === 0)
    return words.map(stripDraft)

  const output: LyricWord[] = []
  let i = 0
  while (i < words.length) {
    const group = validRuns.get(i)
    if (!group) {
      output.push(stripDraft(words[i]))
      i++
      continue
    }
    const slice = words.slice(i, group.to + 1)
    const start = Math.min(...slice.map(w => w.start))
    const end = Math.max(...slice.map(w => w.end))
    output.push({
      text: slice.map(w => w.text).join(''),
      start,
      end: Math.max(start, end),
      ruby: group.ruby,
    })
    i = group.to + 1
  }
  return output
}
