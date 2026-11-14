import type { SharedRubyMark, TtmlWordDraft } from './ttml-ruby'
import type { LyricAgent, LyricAlign, LyricColor, LyricLine, LyricSource, ResolvedLyrics } from './types'
import { nearestLyricColor, parseHexColor } from './colors'
import { preprocessLyricLines } from './preprocess'
import { romanWordsFromSpans } from './romanization'
import { applySharedRubyGroups, parseTtmlRubyContainer, retimePlaceholderWords, spreadRubyTexts } from './ttml-ruby'

/**
 * TTML 歌词解析（AMLL TTML DB / 自定义源，Apple Music 风格），解析规则参考 StarryPlayer：
 * - p 为一行，其中带时间的 span 为音节；span 之间的空白归到前一个音节（拉丁文字的词间空格）
 * - ttm:role="x-bg" 为背景人声，x-translation / x-roman 为翻译 / 音译；head 中的 translations / transliterations 按 itunes:key 挂到对应行。
 *   音译只取拉丁字母的那组（xml:lang 为 *-Latn 的优先；只有假名的读音不当音译）；带 begin / end 的分段按时间对到原文音节上，
 *   直接得到逐字音译（见 romanWordsFromSpans），不再按文字猜测
 * - 演唱者：第一个非 group 的 agent 为主唱，其余为对唱（右对齐），一行多个 agent 或 group 类型为合唱（不偏移）
 * - AMLL 导出的 00:00.000 占位时间：一串占位音节结束于下一个有时间的音节开始，每个占位音节的时长取那个音节的时长
 * 只读取文本与时间属性，不把任何内容作为 HTML 插入页面
 */

/** TTML 时间：hh:mm:ss.fff / mm:ss.fff / ss.fff / 12.3s / 1234ms，返回毫秒；无法解析时返回 null */
export function parseTtmlTime(value: string | null): number | null {
  if (!value)
    return null
  const text = value.trim()
  if (/^\d+(?:\.\d+)?ms$/.test(text))
    return Math.round(Number.parseFloat(text))
  if (/^\d+(?:\.\d+)?s$/.test(text))
    return Math.round(Number.parseFloat(text) * 1000)
  if (!/^\d+(?::\d+){0,2}(?:\.\d+)?$/.test(text))
    return null
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number.parseFloat(part), 0)
  return Math.round(seconds * 1000)
}

/** 按本地名读取属性（ttm:agent、itunes:key 等带前缀的属性在不同文件中前缀可能不同） */
function attr(el: Element, localName: string): string | null {
  for (const attribute of Array.from(el.attributes)) {
    // 不同的 XML 实现对带前缀属性的 localName 处理不一，按冒号后的部分比较
    if ((attribute.localName ?? attribute.name).split(':').pop() === localName)
      return attribute.value
  }
  return null
}

const childElements = (el: Element, localName: string) => Array.from(el.getElementsByTagName('*')).filter(child => (child.localName ?? child.tagName).split(':').pop() === localName)

type Singer = 'primary' | 'secondary' | 'duet'

const DEFAULT_SOLO_COLORS: readonly LyricColor[] = [
  'sky',
  'rose',
  'jade',
  'amber',
  'violet',
  'lake',
  'coral',
  'starry-blue',
]
const DEFAULT_GROUP_COLOR: LyricColor = 'lavender'

interface DeclaredAgent {
  id: string
  type: string
  name?: string
  colorHex?: string
  position?: LyricAlign
}

interface ResolvedAgentRef {
  singer: Singer
  agent?: string
}

function isConventionalGroupId(id: string): boolean {
  return /^v[12]000$/i.test(id)
}

function parseDeclaredPosition(value: string | null): LyricAlign | undefined {
  const v = value?.trim().toLowerCase()
  if (v === 'primary' || v === 'left')
    return 'left'
  if (v === 'secondary' || v === 'right')
    return 'right'
  if (v === 'center')
    return 'center'
  return undefined
}

function readAgentName(agentEl: Element): string | undefined {
  const names = childElements(agentEl, 'name')
  const full = names.find(el => attr(el, 'type') === 'full') ?? names[0]
  const text = full?.textContent?.trim()
  return text || undefined
}

/** 向上查找可继承的指定本地名属性（支持 body / div 继承到 p） */
function resolveInheritedAttr(el: Element, localName: string): string | null {
  let cur: Element | null = el
  while (cur) {
    const tag = (cur.localName ?? cur.tagName).split(':').pop()
    const val = attr(cur, localName)?.trim()
    if (val)
      return val
    if (tag === 'body' || tag === 'tt')
      break
    cur = cur.parentElement
  }
  return null
}

/** 向上查找声部标识属性：ttd:agents（StarryPlayer / 扩展格式）优先于用于摆位的 ttm:agent */
function resolveInheritedVocalAttr(el: Element): string | null {
  return resolveInheritedAttr(el, 'agents') ?? resolveInheritedAttr(el, 'agent')
}

/** 查找 p 所属的段落容器 div */
function ancestorDiv(el: Element): Element | null {
  let cur = el.parentElement
  while (cur) {
    const tag = (cur.localName ?? cur.tagName).split(':').pop()
    if (tag === 'div')
      return cur
    if (tag === 'body' || tag === 'tt')
      break
    cur = cur.parentElement
  }
  return null
}

/** 多演唱者解析：优先识别 ttd:position / ttv:color 等显式元数据，其次按 <head> 声明顺序与出场顺序奇偶分配左/右对齐，group/多 agent 居中合唱 */
function buildAgentResolver(doc: Document): {
  resolve: (agentAttr: string | null) => ResolvedAgentRef
  resolvePosition: (el: Element, inheritFromMain?: boolean) => LyricAlign | undefined
  finalize: (lines: LyricLine[]) => Record<string, LyricAgent> | undefined
} {
  const declaredList: DeclaredAgent[] = childElements(doc.documentElement, 'agent')
    .map(agent => ({
      id: attr(agent, 'id')?.trim() ?? '',
      type: attr(agent, 'type')?.trim() ?? 'person',
      name: readAgentName(agent),
      colorHex: parseHexColor(attr(agent, 'color')),
      position: parseDeclaredPosition(attr(agent, 'position')),
    }))
    .filter(agent => Boolean(agent.id))
  const declaredMap = new Map(declaredList.map(agent => [agent.id, agent]))
  const declaredSoloRank = new Map<string, number>()
  for (const agent of declaredList) {
    if (agent.type !== 'group' && !declaredSoloRank.has(agent.id))
      declaredSoloRank.set(agent.id, declaredSoloRank.size)
  }
  const groups = new Set(declaredList.filter(agent => agent.type === 'group').map(agent => agent.id))
  const appearanceOrder = new Map<string, number>()
  const resolvedAgents = new Map<string, LyricAgent>()

  const ensureSolo = (id: string): { singer: Singer, id: string } => {
    let seenIdx = appearanceOrder.get(id)
    if (seenIdx == null) {
      seenIdx = appearanceOrder.size
      appearanceOrder.set(id, seenIdx)
    }
    const tentativeIdx = declaredSoloRank.get(id) ?? seenIdx
    if (!resolvedAgents.has(id)) {
      resolvedAgents.set(id, {
        id,
        name: declaredMap.get(id)?.name,
        color: DEFAULT_SOLO_COLORS[tentativeIdx % DEFAULT_SOLO_COLORS.length],
      })
    }
    return { singer: tentativeIdx % 2 === 1 ? 'secondary' : 'primary', id }
  }

  return {
    resolve(agentAttr) {
      const ids = (agentAttr ?? '').split(/\s+/).filter(Boolean)
      if (ids.length === 0)
        return { singer: 'primary' }

      if (ids.length > 1 || ids.some(id => groups.has(id) || isConventionalGroupId(id))) {
        const groupId = ids.length === 1 ? ids[0] : ids.join('+')
        if (!resolvedAgents.has(groupId)) {
          const members = ids.length > 1
            ? ids.filter(id => !groups.has(id) && !isConventionalGroupId(id)).map(id => ensureSolo(id).id)
            : undefined
          const singleDeclared = ids.length === 1 ? declaredMap.get(ids[0]) : undefined
          resolvedAgents.set(groupId, {
            id: groupId,
            name: singleDeclared?.name,
            color: DEFAULT_GROUP_COLOR,
            isGroup: true,
            ...(members && members.length > 0 ? { members } : {}),
          })
        }
        return { singer: 'duet', agent: groupId }
      }

      const solo = ensureSolo(ids[0])
      return { singer: solo.singer, agent: solo.id }
    },
    resolvePosition(el, inheritFromMain = true) {
      let cur: Element | null = el
      while (cur) {
        const tag = (cur.localName ?? cur.tagName).split(':').pop()
        const explicitPos = parseDeclaredPosition(attr(cur, 'position'))
        if (explicitPos)
          return explicitPos
        // StarryPlayer 等导出会把摆位载体放在 ttm:agent（如 v1_2=primary / v2_2=secondary），而真实歌手写在 ttd:agents
        const agentIds = (attr(cur, 'agent') ?? '').trim().split(/\s+/).filter(Boolean)
        if (agentIds.length === 1) {
          const declaredPos = declaredMap.get(agentIds[0])?.position
          if (declaredPos)
            return declaredPos
        }
        if (!inheritFromMain || tag === 'body' || tag === 'tt')
          break
        cur = cur.parentElement
      }
      return undefined
    },
    finalize(lines) {
      const usedIds = new Set<string>()
      for (const line of lines) {
        if (line.agent)
          usedIds.add(line.agent)
      }
      if (usedIds.size === 0) {
        for (const line of lines) {
          line.align ??= 'left'
          line.isDuet = line.align === 'right'
        }
        return undefined
      }
      // 将群组引用的成员一并保留，确保合唱多色微光与成员名可查找
      for (const id of Array.from(usedIds)) {
        const agent = resolvedAgents.get(id)
        for (const memberId of agent?.members ?? [])
          usedIds.add(memberId)
      }

      const usedSolos: string[] = []
      let hasGroup = false
      for (const [id, agent] of resolvedAgents) {
        if (!usedIds.has(id))
          continue
        if (agent.isGroup)
          hasGroup = true
        else
          usedSolos.push(id)
      }

      if (usedSolos.length <= 1 && !hasGroup) {
        for (const line of lines) {
          delete line.agent
          line.align = 'left'
          line.isDuet = false
        }
        return undefined
      }

      usedSolos.sort((a, b) => {
        const ra = declaredSoloRank.get(a) ?? Number.MAX_SAFE_INTEGER
        const rb = declaredSoloRank.get(b) ?? Number.MAX_SAFE_INTEGER
        if (ra !== rb)
          return ra - rb
        return (appearanceOrder.get(a) ?? 0) - (appearanceOrder.get(b) ?? 0)
      })
      const finalSoloIdx = new Map(usedSolos.map((id, idx) => [id, idx]))

      const result: Record<string, LyricAgent> = {}
      for (const [id, agent] of resolvedAgents) {
        if (!usedIds.has(id))
          continue
        const declared = declaredMap.get(id)
        const soloIdx = finalSoloIdx.get(id)
        if (soloIdx != null) {
          result[id] = declared?.colorHex
            ? { ...agent, colorHex: declared.colorHex, color: nearestLyricColor(declared.colorHex) }
            : { ...agent, color: DEFAULT_SOLO_COLORS[soloIdx % DEFAULT_SOLO_COLORS.length] }
        }
        else {
          result[id] = declared?.colorHex
            ? { ...agent, colorHex: declared.colorHex, color: nearestLyricColor(declared.colorHex) }
            : agent
        }
      }

      // 为每位实际参演独唱计算默认摆位（供未显式标注位置的 x-bg 等复用到主唱同侧）
      const soloDefaultAlign = new Map<string, LyricAlign>()
      for (const id of usedSolos) {
        const declaredPos = declaredMap.get(id)?.position
        if (declaredPos) {
          soloDefaultAlign.set(id, declaredPos)
          continue
        }
        const firstMainWithPos = lines.find(l => !l.isBackground && l.agent === id && l.align != null)
        if (firstMainWithPos?.align) {
          soloDefaultAlign.set(id, firstMainWithPos.align)
          continue
        }
        const idx = finalSoloIdx.get(id) ?? 0
        soloDefaultAlign.set(id, idx % 2 === 1 ? 'right' : 'left')
      }

      for (const line of lines) {
        const agent = line.agent ? result[line.agent] : undefined
        if (!agent) {
          line.align ??= 'left'
          line.isDuet = line.align === 'right'
          continue
        }
        if (agent.isGroup) {
          line.align = 'center'
          line.isDuet = false
        }
        else {
          const align = line.align ?? soloDefaultAlign.get(agent.id) ?? 'left'
          line.align = align
          line.isDuet = align === 'right'
        }
      }

      return Object.keys(result).length > 0 ? result : undefined
    },
  }
}

interface KeyedTranslation {
  main?: string
  bg?: string
}

/** head 中按 itunes:key 提供的翻译（Apple Music 格式），分别提取主行与 x-bg 背景人声翻译 */
function readKeyedTexts(doc: Document, container: string): Map<string, KeyedTranslation> {
  const texts = new Map<string, KeyedTranslation>()
  for (const block of childElements(doc.documentElement, container)) {
    for (const text of childElements(block, 'text')) {
      const key = attr(text, 'for')
      if (!key || texts.has(key))
        continue
      const main = extractBaseText(text).replace(/\s+/g, ' ').trim() || undefined
      const bgEl = childElements(text, 'span').find(el => attr(el, 'role') === 'x-bg')
      const bg = bgEl?.textContent?.replace(/\s+/g, ' ').trim() || undefined
      if (main || bg)
        texts.set(key, { main, bg })
    }
  }
  return texts
}

interface KeyedRomanization {
  text: string
  // 带时间的分段（一个分段通常对应原文的一个音节，可含多个音拍，如「光」的 hi ka ri）
  spans: { text: string, start: number, end: number }[]
  background?: {
    text: string
    spans: { text: string, start: number, end: number }[]
  }
}

const LATIN_RE = /\p{Script=Latin}/u
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** 提取元素下带 begin / end 时间的直系 span 分段 */
function collectTimedSpans(root: Element, excludeRole: boolean): KeyedRomanization['spans'] {
  const spans: KeyedRomanization['spans'] = []
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== 1)
      continue
    const el = node as Element
    if ((el.localName ?? el.tagName).split(':').pop() !== 'span')
      continue
    if (excludeRole && attr(el, 'role'))
      continue
    const start = parseTtmlTime(attr(el, 'begin'))
    const end = parseTtmlTime(attr(el, 'end'))
    const spanText = el.textContent?.replace(/\s+/g, ' ').trim()
    if (start != null && end != null && spanText)
      spans.push({ text: spanText, start, end: Math.max(start, end) })
  }
  return spans
}

/**
 * head 中按 itunes:key 提供的音译：一份 TTML 可能同时带假名读音（xml:lang="ja"）与罗马音（xml:lang="ja-Latn"），
 * 只取拉丁字母、不含中日韩文字的文本，xml:lang 以 -Latn 结尾的一组优先；同时解析 <span ttm:role="x-bg"> 的背景音译
 */
function readTransliterations(doc: Document): Map<string, KeyedRomanization> {
  const result = new Map<string, KeyedRomanization>()
  const blocks = childElements(doc.documentElement, 'transliteration')
  const latinFirst = [...blocks].sort((a, b) => Number(/-Latn$/i.test(attr(b, 'lang') ?? '')) - Number(/-Latn$/i.test(attr(a, 'lang') ?? '')))
  for (const block of latinFirst) {
    for (const text of childElements(block, 'text')) {
      const key = attr(text, 'for')
      const full = text.textContent?.replace(/\s+/g, ' ').trim()
      if (!key || !full || result.has(key) || !LATIN_RE.test(full) || CJK_RE.test(full))
        continue
      const mainText = extractBaseText(text).replace(/\s+/g, ' ').trim()
      const spans = collectTimedSpans(text, true)
      const bgEl = childElements(text, 'span').find(el => attr(el, 'role') === 'x-bg')
      let background: KeyedRomanization['background']
      if (bgEl) {
        const bgText = bgEl.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        if (bgText) {
          let bgSpans = collectTimedSpans(bgEl, false)
          if (bgSpans.length === 0) {
            const bgStart = parseTtmlTime(attr(bgEl, 'begin'))
            const bgEnd = parseTtmlTime(attr(bgEl, 'end'))
            if (bgStart != null && bgEnd != null)
              bgSpans = [{ text: bgText, start: bgStart, end: Math.max(bgStart, bgEnd) }]
          }
          background = { text: bgText, spans: bgSpans }
        }
      }
      if (mainText || background)
        result.set(key, { text: mainText, spans, ...(background && { background }) })
    }
  }
  return result
}

interface ParsedLineContent {
  words: TtmlWordDraft[]
  plainText?: string
  spanStart?: number | null
  spanEnd?: number | null
  translation?: string
  romanization?: string
  romanizationSpans?: KeyedRomanization['spans']
  agent?: string | null
  el?: Element
  background?: ParsedLineContent
}

/** 提取节点中的正文文本，排除角色副轨（x-translation/x-roman/x-bg）与振假名注音/分隔符（tts:ruby="text|textContainer|delimiter"） */
function extractBaseText(node: Node): string {
  if (node.nodeType === 3)
    return node.textContent ?? ''
  if (node.nodeType !== 1)
    return ''
  const el = node as Element
  if (attr(el, 'role'))
    return ''
  const rubyRole = attr(el, 'ruby')
  if (rubyRole === 'text' || rubyRole === 'textContainer' || rubyRole === 'delimiter')
    return ''
  return Array.from(el.childNodes, extractBaseText).join('')
}

function mergeBackgroundContent(prev: ParsedLineContent | undefined, next: ParsedLineContent, separatedBySpace: boolean): ParsedLineContent {
  if (!prev)
    return next
  if (separatedBySpace && prev.words.length > 0 && next.words.length > 0 && !prev.words.at(-1)!.text.endsWith(' '))
    prev.words[prev.words.length - 1].text += ' '
  const mergedStart = prev.spanStart != null && next.spanStart != null
    ? Math.min(prev.spanStart, next.spanStart)
    : (prev.spanStart ?? next.spanStart)
  const mergedEnd = prev.spanEnd != null && next.spanEnd != null
    ? Math.max(prev.spanEnd, next.spanEnd)
    : (prev.spanEnd ?? next.spanEnd)
  const plainParts = [prev.plainText, next.plainText].filter(Boolean)
  return {
    words: [...prev.words, ...next.words],
    plainText: plainParts.length > 0 ? plainParts.join(' ') : undefined,
    spanStart: mergedStart,
    spanEnd: mergedEnd,
    translation: prev.translation ?? next.translation,
    romanization: prev.romanization ?? next.romanization,
    romanizationSpans: prev.romanizationSpans?.length ? prev.romanizationSpans : next.romanizationSpans,
    agent: prev.agent || next.agent,
    el: prev.el ?? next.el,
  }
}

/** 读取一行（或背景人声）的内容：音节、翻译、音译、振假名，以及嵌套的背景人声 */
function readLineContent(el: Element): ParsedLineContent {
  const content: ParsedLineContent = { words: [] }
  let pendingSpace = false
  let bgPendingSpace = false
  const flushSpace = () => {
    if (!pendingSpace)
      return
    pendingSpace = false
    const last = content.words.at(-1)
    if (last)
      last.text += ' '
  }
  const appendText = (text: string) => {
    if (!text)
      return
    flushSpace()
    const last = content.words.at(-1)
    if (last)
      last.text += text
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      // span 之间的空白作为词间空格挂到前一个音节（行尾或副轨前的缩进空白不追加）；非空白文字直接挂到前一个音节
      const text = node.textContent ?? ''
      if (/^\s+$/.test(text)) {
        pendingSpace = content.words.length > 0
        bgPendingSpace = Boolean(content.background && (content.background.words.length > 0 || content.background.plainText))
      }
      else {
        appendText(text)
      }
      continue
    }
    if (node.nodeType !== 1)
      continue
    const child = node as Element
    if ((child.localName ?? child.tagName).split(':').pop() !== 'span')
      continue
    const role = attr(child, 'role')
    if (role === 'x-translation') {
      content.translation ??= child.textContent?.replace(/\s+/g, ' ').trim() || undefined
      continue
    }
    if (role === 'x-roman') {
      content.romanization ??= child.textContent?.replace(/\s+/g, ' ').trim() || undefined
      continue
    }
    if (role === 'x-bg') {
      const bg = readLineContent(child)
      bg.spanStart = parseTtmlTime(attr(child, 'begin'))
      bg.spanEnd = parseTtmlTime(attr(child, 'end'))
      if (bg.words.length === 0)
        bg.plainText = Array.from(child.childNodes, extractBaseText).join('').replace(/\s+/g, ' ').trim() || undefined
      bg.agent = attr(child, 'agents')?.trim() || attr(child, 'agent')?.trim() || null
      bg.el = child
      content.background = mergeBackgroundContent(content.background, bg, bgPendingSpace)
      bgPendingSpace = false
      continue
    }
    const rubyRole = attr(child, 'ruby')
    if (rubyRole === 'delimiter' || rubyRole === 'text' || rubyRole === 'textContainer')
      continue
    if (rubyRole === 'container') {
      const parsed = parseTtmlRubyContainer(child, attr, parseTtmlTime, extractBaseText)
      if (parsed.start == null || parsed.end == null) {
        appendText(parsed.text)
        continue
      }
      if (parsed.text)
        flushSpace()
      content.words.push({
        text: parsed.text,
        start: parsed.start,
        end: Math.max(parsed.start, parsed.end),
        ...(parsed.ruby && { ruby: parsed.ruby }),
      })
      continue
    }
    const start = parseTtmlTime(attr(child, 'begin'))
    const end = parseTtmlTime(attr(child, 'end'))
    const text = extractBaseText(child)
    if (start == null || end == null) {
      appendText(text)
      continue
    }
    if (text)
      flushSpace()
    const rubyGroupId = attr(child, 'rubyGroup')?.trim()
    const rubyGroup: SharedRubyMark | undefined = rubyGroupId
      ? { id: rubyGroupId, text: attr(child, 'rubyText'), times: attr(child, 'rubyTimes') }
      : undefined
    content.words.push({
      text,
      start,
      end: Math.max(start, end),
      ...(rubyGroup && { rubyGroup }),
    })
  }
  return content
}

function toLine(
  content: ParsedLineContent,
  start: number,
  end: number,
  resolved: ResolvedAgentRef,
  isBackground: boolean,
  explicitAlign?: LyricAlign,
): LyricLine | null {
  let draftWords = content.words
  if (draftWords.length === 0 && content.plainText) {
    const s = content.spanStart ?? start
    const e = Math.max(s, content.spanEnd ?? end)
    draftWords = [{ text: content.plainText, start: s, end: e }]
  }
  if (draftWords.length === 0)
    return null
  const hasPositiveWord = draftWords.some(word => word.start > 0 || word.end > 0)
  const fallbackStart = start === 0 && end === 0 && hasPositiveWord ? 0 : start
  const fallbackEnd = start === 0 && end === 0 && hasPositiveWord
    ? Math.max(...draftWords.map(word => word.end))
    : end
  const retimed = retimePlaceholderWords(draftWords, fallbackStart, fallbackEnd)
  const words = applySharedRubyGroups(retimed, parseTtmlTime).map((word) => {
    if (word.ruby?.length && word.ruby.every(r => r.start === 0 && r.end === 0) && word.end > word.start)
      return { ...word, ruby: spreadRubyTexts(word.ruby.map(r => r.text), word.start, word.end) }
    return word
  })
  if (words.every(word => word.text.trim() === ''))
    return null
  const wordStart = Math.min(...words.map(word => word.start))
  const wordEnd = Math.max(...words.map(word => word.end))
  // 忽略与词区间完全不重叠的 00:00.000 等占位段落边界（同 StarryPlayer Parsers.swift 规则）
  const expandToSpan = end > start && start < wordEnd && end > wordStart
  const align = resolved.singer === 'duet' ? 'center' : explicitAlign
  return {
    words,
    start: expandToSpan ? Math.min(start, wordStart) : wordStart,
    end: expandToSpan ? Math.max(end, wordEnd) : wordEnd,
    translation: content.translation,
    romanization: content.romanization,
    romanizationWords: content.romanizationSpans?.length ? romanWordsFromSpans(content.romanizationSpans, words) ?? undefined : undefined,
    isDuet: align === 'right',
    isBackground,
    ...(align ? { align } : {}),
    ...(resolved.agent ? { agent: resolved.agent } : {}),
  }
}

export function parseTtml(text: string, source: Extract<LyricSource, 'ttml-custom' | 'ttml-amll'>): ResolvedLyrics | null {
  if (typeof DOMParser === 'undefined')
    return null
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || (doc.documentElement.localName ?? '').split(':').pop() !== 'tt')
    return null

  const agentResolver = buildAgentResolver(doc)
  const translations = readKeyedTexts(doc, 'translations')
  const transliterations = readTransliterations(doc)
  const lines: LyricLine[] = []
  let lastDiv: Element | null = null

  for (const p of childElements(doc.documentElement, 'p')) {
    const rawBegin = parseTtmlTime(attr(p, 'begin'))
    const rawEnd = parseTtmlTime(attr(p, 'end'))
    const content = readLineContent(p)
    // 没有音节时间的行：整行为一个词（排除角色副轨与振假名注音文本）
    if (content.words.length === 0) {
      const lineText = extractBaseText(p)
        .replace(/\s+/g, ' ')
        .trim()
      if (lineText && rawBegin != null && rawEnd != null)
        content.words.push({ text: lineText, start: rawBegin, end: rawEnd })
    }
    const key = attr(p, 'key')
    if (key) {
      const tr = translations.get(key)
      if (tr) {
        content.translation ??= tr.main
        if (content.background && (tr.bg ?? tr.main))
          content.background.translation ??= tr.bg
      }
      const romanization = transliterations.get(key)
      if (romanization) {
        if (!content.romanization && romanization.text) {
          content.romanization = romanization.text
          content.romanizationSpans = romanization.spans
        }
        if (content.background && !content.background.romanization && romanization.background?.text) {
          content.background.romanization = romanization.background.text
          content.background.romanizationSpans = romanization.background.spans
        }
      }
    }
    // 整段 <p> 仅有 <span ttm:role="x-bg">、无主唱正文时，按 StarryPlayer 规则提升为主行而非丢弃
    let promotedBg: ParsedLineContent | undefined
    if (content.words.length === 0 && !content.plainText && content.background && (content.background.words.length > 0 || content.background.plainText)) {
      promotedBg = content.background
      content.words = promotedBg.words
      content.plainText = promotedBg.plainText
      content.spanStart = promotedBg.spanStart
      content.spanEnd = promotedBg.spanEnd
      content.translation = promotedBg.translation ?? content.translation
      if (promotedBg.romanization) {
        content.romanization = promotedBg.romanization
        content.romanizationSpans = promotedBg.romanizationSpans
      }
      content.background = undefined
    }
    const inferredStart = content.words.length > 0 ? Math.min(...content.words.map(w => w.start)) : content.spanStart ?? null
    const inferredEnd = content.words.length > 0 ? Math.max(...content.words.map(w => w.end)) : content.spanEnd ?? null
    const begin = rawBegin ?? inferredStart
    const end = rawEnd ?? inferredEnd
    if (begin == null || end == null || (content.words.length === 0 && !content.plainText))
      continue
    const mainAgent = promotedBg?.agent ? agentResolver.resolve(promotedBg.agent) : agentResolver.resolve(resolveInheritedVocalAttr(p))
    const mainExplicitAlign = (promotedBg?.el ? agentResolver.resolvePosition(promotedBg.el, false) : undefined) ?? agentResolver.resolvePosition(p, true)
    const main = toLine(content, begin, end, mainAgent, false, mainExplicitAlign)
    if (!main)
      continue
    const div = ancestorDiv(p)
    if (div && lastDiv && div !== lastDiv)
      main.paragraphStart = true
    if (div)
      lastDiv = div
    const bgContent = content.background
    const hasBgWords = Boolean(bgContent && (bgContent.words.length > 0 || bgContent.plainText))
    const bgAgent = bgContent?.agent ? agentResolver.resolve(bgContent.agent) : mainAgent
    const bgOwnPos = bgContent?.el ? agentResolver.resolvePosition(bgContent.el, false) : undefined
    const bgExplicitAlign = bgContent?.agent ? bgOwnPos : (bgOwnPos ?? mainExplicitAlign)
    const bgFallbackStart = bgContent && bgContent.words.length > 0
      ? Math.min(...bgContent.words.map(word => word.start))
      : (bgContent?.spanStart ?? begin)
    const bgFallbackEnd = bgContent && bgContent.words.length > 0
      ? Math.max(...bgContent.words.map(word => word.end))
      : (bgContent?.spanEnd ?? end)
    const background = hasBgWords && bgContent
      ? toLine(bgContent, bgFallbackStart, bgFallbackEnd, bgAgent, true, bgExplicitAlign)
      : null
    // 背景人声早于主唱开始时排在主行上方，否则在下方，并标记相对位置供分组与展开使用
    if (background) {
      if (background.start < main.words[0].start) {
        background.backgroundPosition = 'above'
        lines.push(background, main)
      }
      else {
        background.backgroundPosition = 'below'
        lines.push(main, background)
      }
    }
    else {
      lines.push(main)
    }
  }

  if (lines.length === 0)
    return null
  const wordTimed = lines.some(line => line.words.length > 1 || line.words.some(word => word.end > word.start && (word.start !== line.start || word.end !== line.end)))
  const processedLines = preprocessLyricLines(lines)
  const agents = agentResolver.finalize(processedLines)
  return { source, wordTimed, instrumental: false, lines: processedLines, ...(agents ? { agents } : {}) }
}
