import type { LyricRomanWord } from './types'

/**
 * 逐字音译（注音行）的分组与排版（纯函数，DOM 的读写在 lyric-player.ts）：
 * - 按原文的字分组：每个字的音译段放在这个字下面，一个字有多个音拍时连在一起（暖 → atata）。
 *   上游音译的空格不能当词的边界：网易云的整行音译、QQ 音乐的逐字音译都在每个音拍后加空格
 * - 音译里的标点与空白不显示（原文里已经有），只剩标点的段丢弃
 * - 排版：第一个音拍的中心对准字的中心；音译可以伸到相邻的字下面，只有与前一个字的音译重叠时才把这个字连同后面的内容往后推
 */

const EDGE_RE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu

/** 音译段显示的文字：去掉首尾的空白与标点 */
export function rubyText(text: string): string {
  return text.replace(EDGE_RE, '')
}

export interface RubyGroup<T extends LyricRomanWord = LyricRomanWord> {
  // 原文的字（音节）下标
  word: number
  parts: T[]
}

/** 按原文的字分组（按字的顺序），去掉显示为空的段 */
export function rubyGroups<T extends LyricRomanWord>(parts: T[]): RubyGroup<T>[] {
  const byWord = new Map<number, T[]>()
  for (const part of parts) {
    if (!rubyText(part.text))
      continue
    const list = byWord.get(part.word)
    if (list)
      list.push(part)
    else
      byWord.set(part.word, [part])
  }
  return [...byWord.entries()].sort(([a], [b]) => a - b).map(([word, list]) => ({ word, parts: list }))
}

export interface RubyMetrics {
  // 单元（字）在行内的左边缘与所在行的顶部（px，未加推移时）
  left: number
  top: number
  // 字、第一个音拍、整段音译的宽度（px）
  charWidth: number
  firstWidth: number
  rubyWidth: number
}

export interface RubyPlacement {
  // 单元的左外边距（与前一个字的音译重叠时往后推的距离，≥ 0）
  shift: number
  // 音译相对字左边缘的偏移（可为负，伸到前一个字下面）
  offset: number
}

/**
 * 依次排版一行中的注音单元：音译居中于字（按第一个音拍），与同一排中前一段音译的间距不小于 gap，不够时推后这个单元；
 * 推后的距离会累加到同一排后面的单元上。换排（top 变化）后重新开始
 */
export function placeRuby(units: RubyMetrics[], gap: number): RubyPlacement[] {
  let pushed = 0
  let previousEnd = Number.NEGATIVE_INFINITY
  let row: number | null = null
  return units.map((unit) => {
    if (row == null || Math.abs(unit.top - row) > 1) {
      row = unit.top
      pushed = 0
      previousEnd = Number.NEGATIVE_INFINITY
    }
    const offset = (unit.charWidth - unit.firstWidth) / 2
    const start = unit.left + pushed + offset
    const shift = Math.max(0, previousEnd + gap - start)
    pushed += shift
    previousEnd = start + shift + unit.rubyWidth
    return { shift, offset }
  })
}
