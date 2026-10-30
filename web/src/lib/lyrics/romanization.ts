import type { LyricLine, LyricRomanWord, LyricWord, ResolvedLyrics } from './types'
import { isKana, toRomaji } from 'wanakana'

/**
 * 逐字音译（见 spec 8.5，规则参考 StarryPlayer 的 LyricRomanizationAligner）：把整行音译切分到原文的音节上，
 * 使音译能显示在对应的字下方并随演唱擦除。对不齐时返回 null（宁缺勿错，只显示整行音译）：
 * 1. 纯汉字行（不含假名）：音译词数与有内容的音节数相同、且每个音节只有一个字时一一配对（拼音、粤拼）
 * 2. 含假名的行（日文）：假名与拉丁文字的音节用自己的读音（wanakana）作为锚点在音译字母中依次查找，
 *    锚点之间的字母按音拍分给其间的汉字音节（浏览器拿不到汉字读音）；锚点找不到、或汉字分不到音拍时视为对不齐
 * 3. 其他（纯拉丁文字、韩文等）不对齐
 * 来源本身带分段时间的音译（TTML 的 transliteration 分段、QQ 音乐 / 酷狗的音译 QRC）按时间对到音节上，不走上面的猜测。
 * 同一个音节分到多段（多个音拍）而这几段没有各自的时间时，按字母数依次分配这个音节的时长，逐字擦除从左到右连续推进
 */

const MACRONS: Record<string, string> = { ā: 'aa', â: 'aa', ī: 'ii', î: 'ii', ū: 'uu', û: 'uu', ē: 'ee', ê: 'ee', ō: 'ou', ô: 'ou' }
const HAN_RE = /\p{Script=Han}/u
const SMALL_KANA_RE = /^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]$/
const SOKUON_RE = /^[っッ]$/
const LONG_MARK_RE = /^[ー〜~]$/
// 锚点前没有待分配的汉字时，允许跳过的字母数（促音重复的辅音等）
const MAX_STRAY_LETTERS = 2
// 每个待分配的汉字最多对应的字母数
const MAX_LETTERS_PER_HAN = 8

/** 折叠为小写 ASCII 字母与数字：去掉声调符号，长音符号展开（ō → ou） */
function foldChar(char: string): string {
  const lower = char.toLowerCase()
  return MACRONS[lower] ?? lower.normalize('NFKD').replace(/[^a-z0-9]/g, '')
}

const fold = (text: string) => [...text].map(foldChar).join('')

interface Token {
  text: string
  // 每个字母及其在 text 中所属字符的下标
  letters: string[]
  offsets: number[]
}

function toToken(text: string): Token {
  const letters: string[] = []
  const offsets: number[] = []
  let offset = 0
  for (const char of text) {
    for (const letter of foldChar(char)) {
      letters.push(letter)
      offsets.push(offset)
    }
    offset += char.length
  }
  return { text, letters, offsets }
}

/** 按音拍切分字母（元音结尾为一拍；单独的 n、重复辅音的前一个各为一拍） */
function splitMorae(letters: string[]): string[][] {
  const vowels = new Set(['a', 'i', 'u', 'e', 'o'])
  const result: string[][] = []
  let current: string[] = []
  letters.forEach((letter, i) => {
    const next = letters[i + 1]
    current.push(letter)
    if (vowels.has(letter) || (letter === 'n' && current.length === 1 && (next == null || (!vowels.has(next) && next !== 'y'))) || (next === letter && !vowels.has(letter))) {
      result.push(current)
      current = []
    }
  })
  if (current.length > 0)
    result.push(current)
  return result
}

/** 把字母按音拍尽量平均地分成 count 份；音拍不够时返回 null。促音留下的单个辅音不单独算一拍，并入前一拍 */
function shareMorae(letters: string[], count: number): string[][] | null {
  const morae: string[][] = []
  for (const mora of splitMorae(letters)) {
    if (morae.length > 0 && mora.length === 1 && !/[aeioun]/.test(mora[0]))
      morae[morae.length - 1] = [...morae[morae.length - 1], ...mora]
    else
      morae.push(mora)
  }
  if (morae.length < count)
    return null
  const result: string[][] = []
  let index = 0
  for (let k = 0; k < count; k++) {
    const take = Math.ceil((morae.length - index) / (count - k))
    result.push(morae.slice(index, index + take).flat())
    index += take
  }
  return result
}

/** 音节的读音：假名与拉丁文字为自己的读音，汉字为 null（未知），标点、促音、长音为空 */
function syllableReadings(words: LyricWord[]): (string | null)[] {
  const texts = words.map(word => word.text.trim())
  const readings: (string | null)[] = texts.map((text) => {
    if (!text || SOKUON_RE.test(text) || LONG_MARK_RE.test(text))
      return ''
    if (HAN_RE.test(text))
      return null
    return fold(isKana(text) ? toRomaji(text) : text)
  })
  // 单独成音节的小假名（きゃ 中的 ゃ）与前一个假名合读
  texts.forEach((text, i) => {
    if (i > 0 && SMALL_KANA_RE.test(text) && isKana(texts[i - 1])) {
      readings[i - 1] = fold(toRomaji(texts[i - 1] + text))
      readings[i] = ''
    }
  })
  return readings
}

/** 读音的常见写法差异：助词は / へ / を，づ / ぢ，长音写成单个元音 */
function readingVariants(reading: string, text: string): string[] {
  const variants = new Set([reading])
  if (text === 'は')
    variants.add('wa')
  if (text === 'へ')
    variants.add('e')
  if (text === 'を')
    variants.add('o')
  for (const variant of [...variants]) {
    variants.add(variant.replace(/du/g, 'zu').replace(/di/g, 'ji'))
    variants.add(variant.replace(/ou/g, 'o').replace(/uu/g, 'u'))
  }
  // 长的写法优先匹配
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length)
}

function matchesAt(letters: string[], at: number, reading: string) {
  for (let i = 0; i < reading.length; i++) {
    if (letters[at + i] !== reading[i])
      return false
  }
  return true
}

/** 把每个字母分给一个音节（下标）；对不齐时返回 null */
function assignLetters(letters: string[], words: LyricWord[]): number[] | null {
  const readings = syllableReadings(words)
  const owner: number[] = Array.from<number>({ length: letters.length }).fill(-1)
  let pointer = 0
  let pending: number[] = []
  let lastOwner = -1

  const distribute = (from: number, to: number): boolean => {
    if (from >= to)
      return pending.length === 0
    if (pending.length === 0) {
      // 没有待分配的汉字：多出的字母归前一个音节（第一个锚点之前的归下一个分到字母的音节）
      for (let i = from; i < to; i++)
        owner[i] = lastOwner
      return true
    }
    const shares = shareMorae(letters.slice(from, to), pending.length)
    if (!shares)
      return false
    let at = from
    shares.forEach((share, k) => {
      for (let i = 0; i < share.length; i++)
        owner[at + i] = pending[k]
      at += share.length
    })
    lastOwner = pending[pending.length - 1]
    pending = []
    return true
  }

  for (let s = 0; s < words.length; s++) {
    const reading = readings[s]
    if (reading === null) {
      pending.push(s)
      continue
    }
    if (!reading)
      continue
    const maxGap = pending.length > 0 ? pending.length * MAX_LETTERS_PER_HAN : MAX_STRAY_LETTERS
    let found: { at: number, length: number } | null = null
    for (let at = pointer; at <= Math.min(letters.length - 1, pointer + maxGap) && !found; at++) {
      const variant = readingVariants(reading, words[s].text.trim()).find(candidate => matchesAt(letters, at, candidate))
      if (variant)
        found = { at, length: variant.length }
    }
    if (!found || !distribute(pointer, found.at))
      return null
    for (let i = found.at; i < found.at + found.length; i++)
      owner[i] = s
    lastOwner = s
    pointer = found.at + found.length
  }
  if (!distribute(pointer, letters.length))
    return null

  // 第一个锚点之前的字母（没有前一个音节）归第一个分到字母的音节
  const first = owner.find(index => index >= 0)
  if (first == null)
    return null
  return owner.map(index => (index >= 0 ? index : first))
}

/** 音译段的长度权重：字母与数字的个数（至少为 1） */
const letterWeight = (text: string) => Math.max(1, fold(text).length)

/** 把一个时间段按各段的字母数依次分给这些段（同一个音节的多个音拍按顺序擦除，而不是同时擦除） */
function splitTime<T extends { text: string }>(items: T[], start: number, end: number): (T & { start: number, end: number })[] {
  const total = items.reduce((sum, item) => sum + letterWeight(item.text), 0)
  let at = start
  let used = 0
  return items.map((item) => {
    used += letterWeight(item.text)
    const next = start + Math.round((end - start) * used / total)
    const piece = { ...item, start: at, end: next }
    at = next
    return piece
  })
}

function build(tokens: Token[], ownerOfLetter: number[], words: LyricWord[]): LyricRomanWord[] {
  const result: LyricRomanWord[] = []
  let letter = 0
  tokens.forEach((token, t) => {
    if (token.letters.length === 0) {
      // 没有字母的词（标点）接在前一段后面
      if (result.length > 0)
        result[result.length - 1].text += ` ${token.text}`
      return
    }
    const owners = token.letters.map((_, k) => ownerOfLetter[letter + k])
    const runs: { word: number, text: string }[] = []
    let runStart = 0
    for (let k = 1; k <= owners.length; k++) {
      if (k === owners.length || owners[k] !== owners[k - 1]) {
        const end = k === owners.length ? token.text.length : token.offsets[k]
        runs.push({ word: owners[k - 1], text: token.text.slice(runStart, end) })
        runStart = end
      }
    }
    letter += token.letters.length
    if (t < tokens.length - 1)
      runs[runs.length - 1].text += ' '
    for (const run of runs)
      result.push({ text: run.text, start: words[run.word].start, end: words[run.word].end, word: run.word })
  })
  // 同一个音节分到的多段依次分配它的时长
  return words.flatMap((word, index) => {
    const parts = result.filter(part => part.word === index)
    return parts.length > 1 ? splitTime(parts, word.start, word.end) : parts
  })
}

/** 拼音、粤拼等：纯汉字行的有内容音节与音译词一一配对 */
function pairPerCharacter(tokens: Token[], words: LyricWord[]): LyricRomanWord[] | null {
  const text = words.map(word => word.text).join('')
  if ([...text].some(char => isKana(char)) || !HAN_RE.test(text))
    return null
  const content = words.flatMap((word, index) => (fold(word.text) || HAN_RE.test(word.text) ? [index] : []))
  const lettered = tokens.filter(token => token.letters.length > 0)
  if (content.length !== lettered.length || !content.every(index => [...words[index].text.trim()].length === 1 || !HAN_RE.test(words[index].text)))
    return null
  return content.map((index, k) => ({
    text: lettered[k].text + (k < content.length - 1 ? ' ' : ''),
    start: words[index].start,
    end: words[index].end,
    word: index,
  }))
}

/** 把整行音译对齐到原文的音节上；对不齐时返回 null */
export function alignRomanization(romanization: string, words: LyricWord[]): LyricRomanWord[] | null {
  const tokens = romanization.split(/\s+/).filter(Boolean).map(toToken)
  if (words.length === 0 || !tokens.some(token => token.letters.length > 0))
    return null
  const paired = pairPerCharacter(tokens, words)
  if (paired)
    return paired
  if (![...words.map(word => word.text).join('')].some(char => isKana(char)))
    return null
  const letters = tokens.flatMap(token => token.letters)
  const owners = assignLetters(letters, words)
  return owners ? build(tokens, owners, words) : null
}

/** 来源本身带逐字时间的音译（QQ 音乐的音译 QRC）：按开始时间归到所在的原文音节 */
export function romanWordsFromTimed(items: { text: string, startTime: number, duration: number }[], words: LyricWord[]): LyricRomanWord[] | null {
  const timed = items.filter(item => item.text.trim() && item.duration > 0)
  if (timed.length === 0 || words.length === 0)
    return null
  return timed.map((item) => {
    let word = 0
    for (let i = 0; i < words.length && words[i].start <= item.startTime + 20; i++)
      word = i
    return { text: item.text, start: item.startTime, end: item.startTime + item.duration, word }
  })
}

/**
 * 带时间的音译分段（TTML 的 transliteration）：按开始时间对到原文音节（开始时间相同的那个，否则为在它之前开始的最后一个），
 * 一段里有多个音拍（以空格分开，如 hi ka ri）时拆开并按字母数依次分配这一段的时长
 */
export function romanWordsFromSpans(spans: { text: string, start: number, end: number }[], words: LyricWord[]): LyricRomanWord[] | null {
  if (spans.length === 0 || words.length === 0)
    return null
  const result: LyricRomanWord[] = []
  for (const span of spans) {
    let word = 0
    for (let i = 0; i < words.length && words[i].start <= span.start + 20; i++)
      word = i
    const morae = span.text.split(/\s+/).filter(Boolean).map(text => ({ text, word }))
    result.push(...splitTime(morae, span.start, span.end))
  }
  return result.length > 0 ? result : null
}

/** 给逐字歌词中还没有逐字音译的行对齐音译 */
export function withRomanizationWords(lyrics: ResolvedLyrics): ResolvedLyrics {
  if (!lyrics.wordTimed)
    return lyrics
  let changed = false
  const lines = lyrics.lines.map((line): LyricLine => {
    if (!line.romanization || line.romanizationWords)
      return line
    const aligned = alignRomanization(line.romanization, line.words)
    if (!aligned)
      return line
    changed = true
    return { ...line, romanizationWords: aligned }
  })
  return changed ? { ...lyrics, lines } : lyrics
}
