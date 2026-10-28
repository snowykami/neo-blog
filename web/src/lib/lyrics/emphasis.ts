import type { LyricColor, LyricEffect, LyricEmphasis, LyricLine, LyricMood, LyricScene, ResolvedLyrics } from './types'
import { normalizeForMatch } from './strip-credits'

/**
 * 歌词强调特效（见 spec 8.2）：
 * - 规则（同 StarryPlayer）：按词判断，一个词唱满 1 秒、且少于 8 个字（拉丁文字还须多于 1 个字母）时强调，
 *   强度 = (min(时长, 2 秒) − 1 秒) / 1 秒。中日文用浏览器的分词（Intl.Segmenter）切词，词由若干逐字音节组成
 * - 歌词标注（后端用大模型对歌词文本做的一次性标注，见 7.2b）：挑出的短语按文本匹配到行内，只要唱满 0.6 秒即演出，
 *   并可指定特效类型与颜色；与标注短语重叠的规则词让位给标注。标注只引用文本，时间一律取自歌词本身
 * - 一行最后一组强调的词加强（同 AMLL），副歌行加强；只处理逐字歌词
 */

export interface LyricAnnotationPhrase {
  text: string
  effect: LyricEffect
  color?: LyricColor
}

export interface LyricAnnotationLine {
  text: string
  mood?: LyricMood
  chorus?: boolean
  scene?: LyricScene
  phrases: LyricAnnotationPhrase[]
}

export interface LyricAnnotations {
  lines: LyricAnnotationLine[]
}

const RULE_MIN_MS = 1000
const FULL_MS = 2000
const RULE_MAX_CHARS = 7
const ANNOTATED_MIN_MS = 600
const ANNOTATED_MIN_FACTOR = 0.3
const LAST_GROUP_BOOST = 1.3
const CHORUS_BOOST = 1.2
// 强度过低时看不出效果，不演出
const MIN_FACTOR = 0.03

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const IGNORED_RE = /[\s\p{P}\p{S}]/u

let segmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined)
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
  return segmenter
}

/** 行内每个 UTF-16 位置所属的词（音节）下标 */
function wordIndexByChar(line: LyricLine): number[] {
  const result: number[] = []
  line.words.forEach((word, index) => {
    for (let i = 0; i < word.text.length; i++)
      result.push(index)
  })
  return result
}

/** 文本区间 [startChar, endChar) 覆盖的词（忽略首尾空白）；没有词时为 null */
function wordRange(text: string, wordAt: number[], startChar: number, endChar: number): { from: number, to: number } | null {
  let first = startChar
  let last = endChar - 1
  while (first <= last && /\s/.test(text[first]))
    first++
  while (last >= first && /\s/.test(text[last]))
    last--
  if (first > last)
    return null
  return { from: wordAt[first], to: wordAt[last] + 1 }
}

function rangeDuration(line: LyricLine, from: number, to: number) {
  return line.words[to - 1].end - line.words[from].start
}

/** 把时长换算为强度：minMs 时为 0，FULL_MS 及以上为 1 */
function factorOf(duration: number, minMs: number) {
  return (Math.min(duration, FULL_MS) - minMs) / (FULL_MS - minMs)
}

/** 行内的词：有分词器时按词切分，否则拉丁文字按空白、中日文按单字 */
function segmentWords(text: string): { index: number, segment: string }[] {
  const seg = getSegmenter()
  if (seg)
    return [...seg.segment(text)].filter(part => part.isWordLike).map(({ index, segment }) => ({ index, segment }))
  const result: { index: number, segment: string }[] = []
  for (const match of text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu))
    result.push({ index: match.index ?? 0, segment: match[0] })
  return result
}

function ruleGroups(line: LyricLine, text: string, wordAt: number[]): LyricEmphasis[] {
  const groups: LyricEmphasis[] = []
  for (const { index, segment } of segmentWords(text)) {
    const chars = [...segment.trim()].length
    const cjk = CJK_RE.test(segment)
    if (chars === 0 || chars > RULE_MAX_CHARS || (!cjk && chars < 2))
      continue
    const range = wordRange(text, wordAt, index, index + segment.length)
    if (!range)
      continue
    const duration = rangeDuration(line, range.from, range.to)
    if (duration <= RULE_MIN_MS)
      continue
    groups.push({ ...range, start: line.words[range.from].start, end: line.words[range.to - 1].end, factor: factorOf(duration, RULE_MIN_MS), effect: 'swell' })
  }
  return groups
}

/** 按归一化文本（忽略空白、标点、大小写）在行内查找短语，返回原文中的区间 */
function findPhrase(text: string, phrase: string): [number, number][] {
  const wanted = normalizeForMatch(phrase)
  if (!wanted)
    return []
  let normalized = ''
  const rawStart: number[] = []
  const rawEnd: number[] = []
  let offset = 0
  for (const char of text) {
    if (!IGNORED_RE.test(char)) {
      for (const lower of char.toLowerCase()) {
        normalized += lower
        rawStart.push(offset)
        rawEnd.push(offset + char.length)
      }
    }
    offset += char.length
  }
  const ranges: [number, number][] = []
  for (let at = normalized.indexOf(wanted); at >= 0; at = normalized.indexOf(wanted, at + wanted.length))
    ranges.push([rawStart[at], rawEnd[at + wanted.length - 1]])
  return ranges
}

function annotatedGroups(line: LyricLine, text: string, wordAt: number[], annotation: LyricAnnotationLine): LyricEmphasis[] {
  const groups: LyricEmphasis[] = []
  for (const phrase of annotation.phrases) {
    for (const [startChar, endChar] of findPhrase(text, phrase.text)) {
      const range = wordRange(text, wordAt, startChar, endChar)
      if (!range)
        continue
      const duration = rangeDuration(line, range.from, range.to)
      if (duration < ANNOTATED_MIN_MS)
        continue
      groups.push({ ...range, start: line.words[range.from].start, end: line.words[range.to - 1].end, factor: Math.max(ANNOTATED_MIN_FACTOR, factorOf(duration, ANNOTATED_MIN_MS)), effect: phrase.effect, color: phrase.color })
    }
  }
  return groups
}

const overlaps = (a: LyricEmphasis, b: LyricEmphasis) => a.from < b.to && b.from < a.to

/** 计算一行的强调分组（按词的顺序，互不重叠） */
export function lineEmphasis(line: LyricLine, annotation?: LyricAnnotationLine | null): LyricEmphasis[] {
  if (line.words.length === 0)
    return []
  const text = line.words.map(word => word.text).join('')
  const wordAt = wordIndexByChar(line)
  const chosen: LyricEmphasis[] = []
  for (const group of [...(annotation ? annotatedGroups(line, text, wordAt, annotation) : []), ...ruleGroups(line, text, wordAt)]) {
    if (!chosen.some(other => overlaps(group, other)))
      chosen.push(group)
  }
  chosen.sort((a, b) => a.from - b.from)

  // 最后一个有文字的词所在的组为行尾组
  let lastWord = line.words.length - 1
  while (lastWord > 0 && !line.words[lastWord].text.trim())
    lastWord--
  const boost = annotation?.chorus ? CHORUS_BOOST : 1
  return chosen
    .map(group => ({ ...group, factor: Math.min(1, group.factor * boost * (group.to > lastWord ? LAST_GROUP_BOOST : 1)) }))
    .filter(group => group.factor >= MIN_FACTOR)
}

/** 给逐字歌词的每一行加上强调分组、情绪基调与粒子场景；标注按行文本（归一化后）匹配，同一文本的行共用一条标注 */
export function applyEmphasis(lyrics: ResolvedLyrics, annotations?: LyricAnnotations | null): ResolvedLyrics {
  if (!lyrics.wordTimed || lyrics.lines.length === 0)
    return lyrics
  const byText = new Map<string, LyricAnnotationLine>()
  for (const line of annotations?.lines ?? []) {
    const key = normalizeForMatch(line.text)
    if (key && !byText.has(key))
      byText.set(key, line)
  }
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => {
      const annotation = byText.get(normalizeForMatch(line.words.map(word => word.text).join(''))) ?? null
      const emphasis = lineEmphasis(line, annotation)
      return { ...line, emphasis: emphasis.length > 0 ? emphasis : undefined, mood: annotation?.mood, scene: annotation?.scene }
    }),
  }
}
