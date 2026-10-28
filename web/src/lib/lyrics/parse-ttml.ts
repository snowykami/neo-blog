import type { LyricLine, LyricSource, LyricWord, ResolvedLyrics } from './types'
import { preprocessLyricLines } from './preprocess'

/**
 * TTML 歌词解析（AMLL TTML DB / 自定义源，Apple Music 风格），解析规则参考 StarryPlayer：
 * - p 为一行，其中带时间的 span 为音节；span 之间的空白归到前一个音节（拉丁文字的词间空格）
 * - ttm:role="x-bg" 为背景人声，x-translation / x-roman 为翻译 / 音译；head 中的 translations / transliterations 按 itunes:key 挂到对应行
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

/** 演唱者分类：第一个非 group 的 agent 为主唱，其余为对唱；group 为合唱 */
function buildSingerResolver(doc: Document): (agentAttr: string | null) => Singer {
  const agents = childElements(doc.documentElement, 'agent').map(agent => ({ id: attr(agent, 'id') ?? '', type: attr(agent, 'type') ?? 'person' }))
  const primary = agents.find(agent => agent.type !== 'group')?.id
  const groups = new Set(agents.filter(agent => agent.type === 'group').map(agent => agent.id))
  return (agentAttr) => {
    const ids = (agentAttr ?? '').split(/\s+/).filter(Boolean)
    if (ids.length === 0 || (primary == null && groups.size === 0))
      return 'primary'
    if (ids.length > 1 || ids.some(id => groups.has(id)))
      return 'duet'
    return ids[0] === primary ? 'primary' : 'secondary'
  }
}

/** head 中按 itunes:key 提供的翻译 / 音译（Apple Music 格式） */
function readKeyedTexts(doc: Document, container: string): Map<string, string> {
  const texts = new Map<string, string>()
  for (const block of childElements(doc.documentElement, container)) {
    for (const text of childElements(block, 'text')) {
      const key = attr(text, 'for')
      const content = text.textContent?.replace(/\s+/g, ' ').trim()
      if (key && content && !texts.has(key))
        texts.set(key, content)
    }
  }
  return texts
}

interface ParsedLineContent {
  words: LyricWord[]
  translation?: string
  romanization?: string
  background?: ParsedLineContent
}

/** 读取一行（或背景人声）的内容：音节、翻译、音译，以及嵌套的背景人声 */
function readLineContent(el: Element): ParsedLineContent {
  const content: ParsedLineContent = { words: [] }
  const appendText = (text: string) => {
    const last = content.words.at(-1)
    if (last)
      last.text += text
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      // span 之间的文字：空白作为词间空格挂到前一个音节；不在 span 内的文字也挂到前一个音节
      const text = node.textContent ?? ''
      appendText(/^\s+$/.test(text) ? ' ' : text)
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
      content.background = readLineContent(child)
      continue
    }
    const start = parseTtmlTime(attr(child, 'begin'))
    const end = parseTtmlTime(attr(child, 'end'))
    const text = child.textContent ?? ''
    if (start == null || end == null) {
      appendText(text)
      continue
    }
    content.words.push({ text, start, end: Math.max(start, end) })
  }
  return content
}

/** AMLL 导出的 00:00.000 占位：一串占位音节结束于下一个有时间的音节开始，时长取那个音节的时长；在行尾时取前一个音节的时长 */
function fixPlaceholderTimes(words: LyricWord[], lineStart: number) {
  if (lineStart <= 0)
    return
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]
    if (word.start !== 0 || word.end !== 0)
      continue
    const next = words[i + 1]
    const prev = words.slice(0, i).reverse().find(item => item.start !== 0 || item.end !== 0)
    const duration = next ? next.end - next.start : prev ? prev.end - prev.start : 0
    const end = next ? next.start : (prev?.end ?? lineStart) + duration
    word.end = end
    word.start = Math.max(lineStart, end - duration)
  }
}

function toLine(content: ParsedLineContent, start: number, end: number, singer: Singer, isBackground: boolean): LyricLine | null {
  fixPlaceholderTimes(content.words, start)
  const words = content.words.length > 0 ? content.words : []
  if (words.every(word => word.text.trim() === ''))
    return null
  const wordStart = Math.min(...words.map(word => word.start))
  const wordEnd = Math.max(...words.map(word => word.end))
  return {
    words,
    start: Math.min(start, wordStart),
    end: Math.max(end, wordEnd),
    translation: content.translation,
    romanization: content.romanization,
    isDuet: singer === 'secondary',
    isBackground,
  }
}

export function parseTtml(text: string, source: Extract<LyricSource, 'ttml-custom' | 'ttml-amll'>): ResolvedLyrics | null {
  if (typeof DOMParser === 'undefined')
    return null
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || (doc.documentElement.localName ?? '').split(':').pop() !== 'tt')
    return null

  const singerOf = buildSingerResolver(doc)
  const translations = readKeyedTexts(doc, 'translations')
  const transliterations = readKeyedTexts(doc, 'transliterations')
  const lines: LyricLine[] = []

  for (const p of childElements(doc.documentElement, 'p')) {
    const begin = parseTtmlTime(attr(p, 'begin'))
    const end = parseTtmlTime(attr(p, 'end'))
    const content = readLineContent(p)
    // 没有音节时间的行：整行为一个词
    if (content.words.length === 0) {
      const lineText = Array.from(p.childNodes)
        .filter(node => node.nodeType === 3 || (node.nodeType === 1 && !attr(node as Element, 'role')))
        .map(node => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      if (lineText && begin != null && end != null)
        content.words.push({ text: lineText, start: begin, end })
    }
    const key = attr(p, 'key')
    if (key) {
      content.translation ??= translations.get(key)
      content.romanization ??= transliterations.get(key)
    }
    if (begin == null || end == null || content.words.length === 0)
      continue
    const singer = singerOf(attr(p, 'agent'))
    const main = toLine(content, begin, end, singer, false)
    if (!main)
      continue
    const background = content.background && content.background.words.length > 0
      ? toLine(content.background, Math.min(...content.background.words.map(word => word.start)), Math.max(...content.background.words.map(word => word.end)), singer, true)
      : null
    // 背景人声早于主唱开始时排在主行上方，否则在下方
    if (background && background.start < main.words[0].start)
      lines.push(background, main)
    else
      lines.push(...[main, background].filter((line): line is LyricLine => line != null))
  }

  if (lines.length === 0)
    return null
  const wordTimed = lines.some(line => line.words.length > 1 || line.words.some(word => word.end > word.start && (word.start !== line.start || word.end !== line.end)))
  return { source, wordTimed, instrumental: false, lines: preprocessLyricLines(lines) }
}
