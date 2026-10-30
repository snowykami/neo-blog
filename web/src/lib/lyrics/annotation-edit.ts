import type { LyricAnnotationLine, LyricAnnotationPhrase, LyricAnnotations } from './emphasis'
import type { LyricPace } from './pace'
import type { LyricColor, LyricEffect, LyricFont, LyricMood, LyricSceneName, LyricTextStyle } from './types'

/**
 * 后台歌词特效编辑器的数据处理（纯函数）：标注按行文本保存（同一文本的行共用一条），所以编辑器按「去重后的行」编辑；
 * 短语按文本匹配到行内（同一行里出现几次就在几处演出，与播放器一致），新加的短语会替换与它重叠的旧短语
 */

export interface PhraseForm {
  text: string
  effect: LyricEffect
  color: LyricColor | ''
  font: LyricFont | ''
  styles: LyricTextStyle[]
  pace: 'slow' | 'fast' | ''
}

export interface LineForm {
  text: string
  mood: LyricMood | ''
  chorus: boolean
  chorusStart: boolean
  // 内置场景或 custom:<name>（这首歌的自定义粒子）
  scene: LyricSceneName | ''
  sceneColor: LyricColor | ''
  // 场景持续的行数（含这一行），0 为默认行数
  sceneLines: number
  phrases: PhraseForm[]
}

export interface AnnotationForm {
  font: LyricFont | ''
  pace: LyricPace
  intro: string
  // 主题色 #rrggbb，为空时用封面主色
  accent: string
  // 聚光灯的各处：完整歌词中的行号（同一句重复时可以只选其中几次），升序
  spotlights: number[]
  lines: LineForm[]
}

// 聚光灯的上限：不同的句子最多 MAX_SPOTLIGHTS 句，合计最多 MAX_SPOTLIGHT_LINES 处（与后端一致）
export const MAX_SPOTLIGHTS = 3
export const MAX_SPOTLIGHT_LINES = 6

/** 能否再给第 index 行加聚光灯：合计未满，且这一句已在聚光灯中或不同的句子未满 */
export function canAddSpotlight(lines: string[], spotlights: number[], index: number): boolean {
  if (spotlights.includes(index))
    return true
  const texts = new Set(spotlights.map(i => lines[i]))
  return spotlights.length < MAX_SPOTLIGHT_LINES && (texts.has(lines[index]) || texts.size < MAX_SPOTLIGHTS)
}

/** 一条去重后的行：文本与它在完整歌词中出现的行号 */
export interface UniqueLine {
  text: string
  indices: number[]
}

export function uniqueLyricLines(lines: string[]): UniqueLine[] {
  const result: UniqueLine[] = []
  const byText = new Map<string, UniqueLine>()
  lines.forEach((text, index) => {
    let line = byText.get(text)
    if (!line) {
      line = { text, indices: [] }
      byText.set(text, line)
      result.push(line)
    }
    line.indices.push(index)
  })
  return result
}

/** 短语在行内每次出现的位置 [start, end)（按 JS 字符串下标，互不重叠） */
export function phraseRanges(line: string, phrase: string): [number, number][] {
  const ranges: [number, number][] = []
  if (!phrase)
    return ranges
  for (let at = line.indexOf(phrase); at >= 0; at = line.indexOf(phrase, at + phrase.length))
    ranges.push([at, at + phrase.length])
  return ranges
}

export interface LineSegment {
  text: string
  start: number
  end: number
  // 所在短语的下标，普通文字为 undefined
  phrase?: number
}

/** 把一行切成普通文字与短语片段（短语互相重叠时先出现在列表里的优先） */
export function lineSegments(line: string, phrases: Pick<PhraseForm, 'text'>[]): LineSegment[] {
  const owner: (number | undefined)[] = Array.from({ length: line.length })
  phrases.forEach((phrase, index) => {
    for (const [start, end] of phraseRanges(line, phrase.text)) {
      if (owner.slice(start, end).every(value => value === undefined))
        owner.fill(index, start, end)
    }
  })
  const segments: LineSegment[] = []
  for (let i = 0; i < line.length;) {
    let j = i + 1
    while (j < line.length && owner[j] === owner[i])
      j++
    segments.push({ text: line.slice(i, j), start: i, end: j, phrase: owner[i] })
    i = j
  }
  return segments
}

/** 选区去掉两端的空白后的范围；只有空白时为 null */
export function trimSelection(line: string, start: number, end: number): [number, number] | null {
  let from = Math.max(0, Math.min(start, end))
  let to = Math.min(line.length, Math.max(start, end))
  while (from < to && /\s/.test(line[from]))
    from++
  while (to > from && /\s/.test(line[to - 1]))
    to--
  return from < to ? [from, to] : null
}

/** 在选区 [start, end) 上加一个短语：去掉与它重叠（任一次出现与选区相交）或文本相同的旧短语 */
export function addPhrase(line: string, phrases: PhraseForm[], start: number, end: number, phrase: Omit<PhraseForm, 'text'>): PhraseForm[] {
  const text = line.slice(start, end)
  const kept = phrases.filter(existing => existing.text !== text
    && !phraseRanges(line, existing.text).some(([from, to]) => from < end && start < to))
  return [...kept, { ...phrase, text }]
}

export function emptyLineForm(text: string): LineForm {
  return { text, mood: '', chorus: false, chorusStart: false, scene: '', sceneColor: '', sceneLines: 0, phrases: [] }
}

function toPhraseForm(phrase: LyricAnnotationPhrase): PhraseForm {
  return {
    text: phrase.text,
    effect: phrase.effect,
    color: phrase.color ?? '',
    font: phrase.font ?? '',
    styles: phrase.styles ?? [],
    pace: phrase.pace === 'slow' || phrase.pace === 'fast' ? phrase.pace : '',
  }
}

/** 后端的标注转为编辑表单：每条去重后的行一项（没有标注的行为空），聚光灯换算成完整歌词中的行号（找不到的丢弃） */
export function toAnnotationForm(lines: string[], annotation: LyricAnnotations | null): AnnotationForm {
  const byText = new Map((annotation?.lines ?? []).map(line => [line.text, line]))
  const unique = uniqueLyricLines(lines)
  return {
    font: annotation?.font ?? '',
    pace: annotation?.pace ?? 'medium',
    intro: annotation?.intro ?? '',
    accent: annotation?.accent ?? '',
    spotlights: [...new Set((annotation?.spotlights ?? []).flatMap((spot) => {
      const index = unique.find(line => line.text === spot.text)?.indices[spot.occurrence]
      return index == null ? [] : [index]
    }))].sort((a, b) => a - b),
    lines: unique.map(({ text }) => {
      const line = byText.get(text)
      if (!line)
        return emptyLineForm(text)
      return {
        text,
        mood: line.mood ?? '',
        chorus: !!(line.chorus || line.chorusStart),
        chorusStart: !!line.chorusStart,
        scene: line.scene ?? '',
        sceneColor: line.sceneColor ?? '',
        sceneLines: line.sceneLines ?? 0,
        phrases: line.phrases.map(toPhraseForm),
      }
    }),
  }
}

/** 编辑表单转为保存请求：只保留有标注的行，去掉空字段 */
export function fromAnnotationForm(lines: string[], form: AnnotationForm) {
  const annotated: LyricAnnotationLine[] = form.lines
    .filter(line => line.mood || line.chorus || line.chorusStart || line.scene || line.phrases.length > 0)
    .map(line => ({
      text: line.text,
      ...(line.mood && { mood: line.mood }),
      ...((line.chorus || line.chorusStart) && { chorus: true }),
      ...(line.chorusStart && { chorusStart: true }),
      ...(line.scene && { scene: line.scene, ...(line.sceneColor && { sceneColor: line.sceneColor }), ...(line.sceneLines > 0 && { sceneLines: line.sceneLines }) }),
      phrases: line.phrases.map(phrase => ({
        text: phrase.text,
        effect: phrase.effect,
        ...(phrase.color && { color: phrase.color }),
        ...(phrase.font && { font: phrase.font }),
        ...(phrase.styles.length > 0 && { styles: phrase.styles }),
        ...(phrase.pace && { pace: phrase.pace }),
      })),
    }))
  return {
    font: form.font || undefined,
    pace: form.pace === 'medium' ? undefined : form.pace,
    intro: form.intro.trim(),
    accent: form.accent || undefined,
    spotlights: [...new Set(form.spotlights)]
      .filter(index => lines[index] != null)
      .sort((a, b) => a - b)
      .map(index => ({ text: lines[index], occurrence: lines.slice(0, index).filter(line => line === lines[index]).length })),
    lines: annotated,
  }
}
