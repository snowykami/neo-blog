import type { LyricTargetLang } from './lyric-language'
import type { PronunciationLangBucket } from './target-lang'
import type { LyricLang, LyricLine, LyricRomanWord, LyricWord, ResolvedLyrics } from './types'
import { getLyricLineText } from './line-utils'
import { classifyVocalLine, detectLyricTextLang, normalizeLyricLangTag } from './lyric-language'
import { alignRomanization, romanWordsFromSpans } from './romanization'
import { normalizeForMatch } from './strip-credits'
import { toPronunciationBucket } from './target-lang'

export interface SiteLyricPronunciationLine {
  text: string
  occurrence: number
  bg?: boolean
  lang?: LyricLang | string
  pronunciation?: string
  tokens?: string[]
}

export interface SiteLyricPronunciations {
  status: 'ready' | 'pending'
  stale?: boolean
  partial?: boolean
  completeUpstream?: boolean
  source?: string
  lang?: string
  lines: SiteLyricPronunciationLine[]
}

const PRONOUNCEABLE_RE = /[\p{L}\p{N}]/u
const HAN_TEST_RE = /\p{Script=Han}/u
const HAN_CHAR_RE = /\p{Script=Han}/gu
const PURE_HAN_WORD_RE = /^\p{Script=Han}+$/u
const BOPOMOFO_RE = /[\u3100-\u312F\u31A0-\u31BF]/
const JYUTPING_RE = /\b[a-z]{1,6}[1-6]\b/
const CANTONESE_PARTICLES_RE = /[嘅咗喺冇係唔啲嚟咁乜咩仲畀揾搵睇佢哋]/
const HOKKIEN_MARKERS_RE = /[袂毋𨑨迌佇囥]|啥物|歹势|歹勢|仝款|按怎|家己|佗位|叨位/u
const KANA_OR_HANGUL_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const ANY_CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const OTHER_NON_LATIN_RE = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}]/u
function isLiaisonTieChar(ch: string): boolean {
  return ch === '‿' || ch === '\u0361' || ch === '\u035C'
}

function hasLiaisonTie(text: string): boolean {
  for (const ch of text) {
    if (isLiaisonTieChar(ch))
      return true
  }
  return false
}

function splitOnLiaisonTie(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of text) {
    if (isLiaisonTieChar(ch)) {
      out.push(cur)
      cur = ''
    }
    else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}
const SOURCE_VOWEL_RE = /[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüÿ]/i
const PHONETIC_VOWEL_RE = /[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüÿɑɒɔəɚɛɜɝɪɨʊʉʌɯɤɐɶʏ]/i
const COMBINING_OR_MOD_RE = /^[\p{M}ːˑ˞ʰʷʲ]$/u
const SILENT_TAIL_SET = new Set(['e', 'es', 's', 'x', 'z', 't', 'd', 'p', 'ts', 'ds'])
const EDGE_STRIP_RE = /^(?:[\s\p{P}]|(?!\u02D9)\p{S})+|(?:[\s\p{P}]|(?!\u02D9)\p{S})+$/gu
const SHORT_FILLER_LATIN_WORDS = new Set([
  'oh',
  'ooh',
  'oooh',
  'ah',
  'ahh',
  'aah',
  'yeah',
  'yea',
  'yep',
  'nah',
  'na',
  'la',
  'da',
  'ba',
  'ra',
  'sha',
  'hey',
  'yo',
  'uh',
  'mm',
  'hmm',
  'hm',
  'baby',
  'woo',
  'woah',
  'whoa',
  'ha',
  'haha',
  'eh',
  'ay',
  'ayy',
  'hu',
  'uhh',
  'mhm',
  'o',
  'nya',
  'ny',
  'bala',
  'dala',
  'pico',
  'bibo',
  'dido',
  'nino',
  'pa',
  'pap',
  'doo',
  'bop',
  'cha',
  'ding',
  'dong',
  'boom',
  'bang',
  'ya',
  'yoo',
  'wah',
  'wo',
])

/** 检查词元是否包含字母或数字（与后端 filterPronounceableTokens 对齐） */
function hasPronounceableChar(text: string): boolean {
  return PRONOUNCEABLE_RE.test(text)
}

/** 从逐字词元数组中提取所有含字母/数字的词元下标（排除纯标点与纯空格） */
export function extractPronounceableWordIndices(words: LyricWord[]): number[] {
  const indices: number[] = []
  words.forEach((word, index) => {
    if (hasPronounceableChar(word.text))
      indices.push(index)
  })
  return indices
}

interface SurfaceWordFragment {
  wordIdx: number
  text: string
  lowerLetters: string
  weight: number
  hasVowel: boolean
}

interface SurfaceWordGroup {
  joinedText: string
  fragments: SurfaceWordFragment[]
}

function stripPronEdge(raw: string): string {
  return raw.replace(EDGE_STRIP_RE, '')
}

function splitPhonemeClusters(raw: string): string[] {
  const chars = [...raw]
  const clusters: string[] = []
  let prefix = ''
  let i = 0
  while (i < chars.length) {
    const ch = chars[i]
    if (ch === '.' || /\s/.test(ch)) {
      i++
      continue
    }
    if (ch === 'ˈ' || ch === 'ˌ' || ch === '\'') {
      prefix += ch
      i++
      continue
    }
    let cluster = prefix + ch
    prefix = ''
    i++
    while (i < chars.length) {
      const next = chars[i]
      if (COMBINING_OR_MOD_RE.test(next) || isLiaisonTieChar(next)) {
        cluster += next
        i++
        if (isLiaisonTieChar(next) && i < chars.length) {
          cluster += chars[i]
          i++
        }
        continue
      }
      break
    }
    clusters.push(cluster)
  }
  if (prefix && clusters.length > 0)
    clusters[clusters.length - 1] += prefix
  return clusters
}

function endsWithVowelSound(text: string): boolean {
  let lastBase = ''
  for (const ch of text) {
    if (COMBINING_OR_MOD_RE.test(ch))
      continue
    lastBase = ch
  }
  return Boolean(lastBase && PHONETIC_VOWEL_RE.test(lastBase))
}

function distributeUnitsAcrossFragments(units: string[], frags: SurfaceWordFragment[], sep: string): string[] {
  const n = units.length
  const k = frags.length
  const totalW = frags.reduce((sum, f) => sum + f.weight, 0) || k
  const out = Array.from<string>({ length: k }).fill('')
  let cursor = 0
  let cumW = 0

  const sliceHasVowel = (from: number, to: number) => {
    for (let u = from; u < to; u++) {
      if (PHONETIC_VOWEL_RE.test(units[u]))
        return true
    }
    return false
  }

  for (let j = 0; j < k - 1; j++) {
    cumW += frags[j].weight
    const minEnd = Math.min(cursor + 1, n - (k - 1 - j))
    const maxEnd = n - (k - 1 - j)
    const ideal = Math.round((n * cumW) / totalW)
    let end = Math.min(Math.max(ideal, minEnd), maxEnd)

    if (sep === '') {
      if (!frags[j].hasVowel && !sliceHasVowel(cursor, minEnd)) {
        end = minEnd
      }
      else {
        if (frags[j].hasVowel && !sliceHasVowel(cursor, end) && end < maxEnd && PHONETIC_VOWEL_RE.test(units[end]))
          end++
        const remWeight = totalW - cumW
        if (!frags[j + 1].hasVowel && (n - end) < remWeight && end > minEnd && sliceHasVowel(cursor, end - 1) && !PHONETIC_VOWEL_RE.test(units[end - 1]))
          end--
        if (end > minEnd && units[end - 1].startsWith('ˈ') && !PHONETIC_VOWEL_RE.test(units[end - 1]) && end < maxEnd) {
          if (sliceHasVowel(cursor, end - 1))
            end--
          else
            end++
        }
      }
    }

    out[j] = units.slice(cursor, end).join(sep)
    cursor = end
  }
  out[k - 1] = units.slice(cursor).join(sep)
  return out
}

function splitPronUnitAcrossFragments(pronUnit: string, frags: SurfaceWordFragment[]): string[] {
  const k = frags.length
  if (k === 0)
    return []
  if (k === 1)
    return [stripPronEdge(pronUnit)]

  if (pronUnit.includes('.')) {
    const dotParts = pronUnit.split('.').map(stripPronEdge).filter(Boolean)
    if (dotParts.length > 0 && dotParts.every(dp => PHONETIC_VOWEL_RE.test(dp))) {
      if (dotParts.length === k)
        return dotParts
      if (dotParts.length > k)
        return distributeUnitsAcrossFragments(dotParts, frags, '.')
    }
  }

  const cleaned = stripPronEdge(pronUnit)
  if (k === 2 && frags[0].weight >= 2 && SILENT_TAIL_SET.has(frags[1].lowerLetters) && endsWithVowelSound(cleaned))
    return [cleaned, '']

  const clusters = splitPhonemeClusters(cleaned)
  if (clusters.length === 0)
    return Array.from<string>({ length: k }).fill('')
  if (clusters.length <= k)
    return Array.from({ length: k }, (_, i) => clusters[i] ?? '')
  return distributeUnitsAcrossFragments(clusters, frags, '')
}

function buildSurfaceWordGroups(words: LyricWord[]): SurfaceWordGroup[] {
  const groups: SurfaceWordGroup[] = []
  let curFrags: SurfaceWordFragment[] = []
  let curJoined = ''
  let prevChunk = ''
  let prevEndedSpace = true

  const flush = () => {
    if (curFrags.length > 0) {
      groups.push({ joinedText: curJoined, fragments: curFrags })
      curFrags = []
      curJoined = ''
    }
  }

  words.forEach((word, wordIdx) => {
    const raw = word.text
    if (!raw)
      return
    if (!raw.trim()) {
      prevEndedSpace = true
      return
    }
    let lastEnd = 0
    for (const match of raw.matchAll(/\S+/g)) {
      const matchIndex = match.index ?? 0
      if (matchIndex > lastEnd)
        prevEndedSpace = true
      const chunk = match[0]
      const endPos = matchIndex + chunk.length
      const trailSpace = endPos < raw.length && /\s/.test(raw.slice(endPos))
      lastEnd = endPos

      if (!hasPronounceableChar(chunk)) {
        if (trailSpace)
          prevEndedSpace = true
        continue
      }

      const canContinue = !prevEndedSpace && curFrags.length > 0 && !ANY_CJK_RE.test(prevChunk) && !ANY_CJK_RE.test(chunk)
      if (!canContinue)
        flush()

      const letters = ([...chunk].filter(c => PRONOUNCEABLE_RE.test(c)).join('')).toLowerCase()
      curJoined += chunk
      curFrags.push({
        wordIdx,
        text: chunk,
        lowerLetters: letters,
        weight: Math.max(1, [...letters].length),
        hasVowel: SOURCE_VOWEL_RE.test(chunk),
      })
      prevChunk = chunk
      prevEndedSpace = trailSpace
    }
    if (lastEnd < raw.length && /\s/.test(raw.slice(lastEnd)))
      prevEndedSpace = true
  })
  flush()
  return groups
}

function alignWordsBySurfaceWordGroups(
  words: LyricWord[],
  tokens: string[] | undefined,
  fallback: string,
): LyricRomanWord[] | null {
  const surfaceWords = buildSurfaceWordGroups(words)
  const target = surfaceWords.length
  if (target === 0)
    return null

  const cleanUnits = (arr: string[]) => arr.map(stripPronEdge).filter(Boolean)
  let pronUnits: string[] | null = null

  if (tokens && tokens.length > 0) {
    const cleaned = cleanUnits(tokens)
    if (cleaned.length === target)
      pronUnits = cleaned
  }
  if (!pronUnits) {
    const wsUnits = cleanUnits(fallback.split(/\s+/))
    if (wsUnits.length === target) {
      pronUnits = wsUnits
    }
    else if (wsUnits.length > 0 && wsUnits.length < target && hasLiaisonTie(fallback)) {
      const expanded: string[] = []
      for (let i = 0; i < wsUnits.length; i++) {
        const unit = wsUnits[i]
        const curIdx = expanded.length
        const remFields = wsUnits.length - i - 1
        const remNeeded = target - curIdx
        if (curIdx < target && remNeeded > remFields + 1 && hasLiaisonTie(unit) && !surfaceWords[curIdx].joinedText.includes('-')) {
          for (const sub of splitOnLiaisonTie(unit)) {
            const c = stripPronEdge(sub)
            if (c)
              expanded.push(c)
          }
        }
        else {
          expanded.push(unit)
        }
      }
      if (expanded.length === target)
        pronUnits = expanded
    }
  }

  if (!pronUnits || pronUnits.length !== target)
    return null

  const byWordIdx = new Map<number, string[]>()
  surfaceWords.forEach((sw, idx) => {
    const pieces = splitPronUnitAcrossFragments(pronUnits![idx], sw.fragments)
    sw.fragments.forEach((frag, fIdx) => {
      const piece = pieces[fIdx]?.trim()
      if (!piece)
        return
      const list = byWordIdx.get(frag.wordIdx)
      if (list)
        list.push(piece)
      else
        byWordIdx.set(frag.wordIdx, [piece])
    })
  })

  const orderedEntries = [...byWordIdx.entries()].sort(([a], [b]) => a - b)
  if (orderedEntries.length === 0)
    return null
  return orderedEntries.map(([wordIdx, pieces], idx) => ({
    text: pieces.join(' ') + (idx < orderedEntries.length - 1 ? ' ' : ''),
    start: words[wordIdx].start,
    end: words[wordIdx].end,
    word: wordIdx,
  }))
}

/**
 * 将 AI 返回的逐词读音 tokens 对齐为前端逐字擦除所需的 LyricRomanWord[]：
 * 1. tokens 数量与可发音词元数量严格一致时，一一对应绑定每个 LyricWord 的起止时间
 * 2. 若未提供严格 1-to-1 tokens 且原文全为汉字，按汉字总数与空格分隔音节数尝试均分时间 span 后复用 romanWordsFromSpans
 * 3. 若词源按多音节/跨词切分而读音按自然词返回（含法语连诵 ‿ 与音节符 .），按自然词边界归组后再拆回实际歌词音节
 * 4. 若仍无法严格对齐，最后尝试原生 alignRomanization（日文假名/单字拼音场景），失败则返回 null 整行回退显示
 */
export function buildRomanWordsFromAiTokens(
  words: LyricWord[],
  tokens?: string[],
  fallbackPronunciation?: string,
): LyricRomanWord[] | null {
  if (words.length === 0)
    return null
  const indices = extractPronounceableWordIndices(words)
  if (indices.length === 0)
    return null

  if (tokens && tokens.length === indices.length) {
    const pairs: { wordIdx: number, text: string }[] = []
    for (let k = 0; k < indices.length; k++) {
      const cleaned = tokens[k]?.trim() ?? ''
      if (!cleaned)
        continue
      pairs.push({ wordIdx: indices[k], text: cleaned })
    }
    if (pairs.length > 0) {
      return pairs.map((item, idx) => ({
        text: item.text + (idx < pairs.length - 1 ? ' ' : ''),
        start: words[item.wordIdx].start,
        end: words[item.wordIdx].end,
        word: item.wordIdx,
      }))
    }
  }

  const fallback = fallbackPronunciation?.trim()
  if (!fallback)
    return null

  const parts = fallback.split(/\s+/).filter(Boolean)
  if (parts.length > 0) {
    if (parts.length === indices.length) {
      return indices.map((wordIdx, k) => ({
        text: parts[k] + (k < indices.length - 1 ? ' ' : ''),
        start: words[wordIdx].start,
        end: words[wordIdx].end,
        word: wordIdx,
      }))
    }

    const allPureHan = indices.every(idx => PURE_HAN_WORD_RE.test(words[idx].text.trim()))
    if (allPureHan) {
      let totalHan = 0
      const hanCounts = indices.map((idx) => {
        const count = words[idx].text.trim().match(HAN_CHAR_RE)?.length ?? 0
        totalHan += count
        return count
      })
      if (totalHan > 0 && totalHan === parts.length) {
        const spans: { text: string, start: number, end: number }[] = []
        let cursor = 0
        for (let i = 0; i < indices.length; i++) {
          const word = words[indices[i]]
          const count = hanCounts[i]
          const duration = Math.max(1, word.end - word.start)
          for (let j = 0; j < count; j++) {
            const start = word.start + Math.round((duration * j) / count)
            const end = word.start + Math.round((duration * (j + 1)) / count)
            spans.push({ text: parts[cursor++], start, end: Math.max(start + 1, end) })
          }
        }
        const aligned = romanWordsFromSpans(spans, words)
        if (aligned && aligned.length > 0) {
          return aligned.map((item, idx) => ({
            ...item,
            text: idx < aligned.length - 1 ? `${item.text.trim()} ` : item.text.trim(),
          }))
        }
      }
    }

    const surfaceAligned = alignWordsBySurfaceWordGroups(words, tokens, fallback)
    if (surfaceAligned && surfaceAligned.length > 0)
      return surfaceAligned
  }

  return alignRomanization(fallback, words)
}

function refineDetectedHanSongLang(detected: LyricLang | null, texts: string[]): LyricLang | null {
  if (detected === 'zh' || detected === 'zh-tw') {
    if (texts.some(t => CANTONESE_PARTICLES_RE.test(t)))
      return 'zh-hk'
    if (texts.some(t => HOKKIEN_MARKERS_RE.test(t)))
      return 'other'
  }
  return detected
}

/** 识别单行歌词的读音归属语种（区分 Mandarin `zh` / 台式注音 `zh-tw` / 粤语 `zh-hk` / `ja` / `ko` / `en` / `other`；闽南语归入 `other`） */
export function detectLinePronunciationLang(text: string, pron?: string, songLang?: string | null): LyricLang {
  const rom = pron?.trim() ?? ''
  if (rom && BOPOMOFO_RE.test(rom))
    return 'zh-tw'
  if (rom && JYUTPING_RE.test(rom.toLowerCase()))
    return 'zh-hk'
  if (CANTONESE_PARTICLES_RE.test(text))
    return 'zh-hk'
  if (HOKKIEN_MARKERS_RE.test(text))
    return 'other'
  const detected = detectLyricTextLang([text])
  if (detected)
    return detected
  if (songLang === 'other')
    return 'other'
  return normalizeLyricLangTag(songLang) ?? 'other'
}

/**
 * 同语言读音自动隐藏策略：
 * - 简中 / 繁中用户听普通话歌词隐藏拼音/注音，但保留粤语（`zh-hk`）粤拼与外语读音
 * - 港繁（`zh-hk`）用户听粤语歌词隐藏粤拼，但保留普通话拼音与外语读音
 * - 英文用户听英文歌隐藏音标
 * - 日语、韩语、其他小语种在任何界面语言下永不自动隐藏
 */
export function shouldHideSameLangPronunciation(
  lineLang: LyricLang | string | null | undefined,
  targetLang: LyricTargetLang,
): boolean {
  if (!lineLang || lineLang === 'other')
    return false
  const norm: LyricLang | null = lineLang === 'zh-tw' || lineLang === 'zh-hk' ? lineLang : normalizeLyricLangTag(lineLang)
  if (!norm || norm === 'other' || norm === 'ja' || norm === 'ko')
    return false
  if (targetLang === 'zh' || targetLang === 'zh-tw')
    return norm === 'zh' || norm === 'zh-tw'
  if (targetLang === 'zh-hk')
    return norm === 'zh-hk'
  if (targetLang === 'en')
    return norm === 'en'
  return false
}

function isSubstantivePronounceableLine(vocalText: string): boolean {
  if (HAN_TEST_RE.test(vocalText) || KANA_OR_HANGUL_RE.test(vocalText) || OTHER_NON_LATIN_RE.test(vocalText))
    return true
  const words = vocalText.toLowerCase().match(/[a-z']+/g) ?? []
  if (words.length === 0)
    return false
  return words.some(w => !SHORT_FILLER_LATIN_WORDS.has(w))
}

export interface CanAiPronounceOptions {
  includeSameLang?: boolean
  isLangEnabled?: (lineLang: LyricLang) => boolean
}

/** 识别整首歌曲所属的读音偏好分桶（zh / zh-hk / en / ja / ko / other） */
export function detectSongPronunciationBucket(
  lyrics: ResolvedLyrics,
  aiPronunciation?: SiteLyricPronunciations | null,
  artists: string[] = [],
): PronunciationLangBucket | null {
  if (lyrics.source === 'none' || lyrics.instrumental || lyrics.lines.length === 0)
    return null

  const classified = lyrics.lines
    .map(line => classifyVocalLine(getLyricLineText(line), artists))
    .filter((text): text is string => Boolean(text && hasPronounceableChar(text)))
  const vocalTexts = classified.length > 0
    ? classified
    : lyrics.lines.map(line => getLyricLineText(line).trim()).filter(Boolean)
  if (vocalTexts.length === 0)
    return null

  const aiMatchesSource = aiPronunciation != null && (!aiPronunciation.source || aiPronunciation.source === lyrics.source)
  if (aiMatchesSource && aiPronunciation.lang === 'zh-hk')
    return 'zh-hk'

  const detected = detectLyricTextLang(vocalTexts)
  const refined = refineDetectedHanSongLang(detected, vocalTexts)
  const nativeJyutpingCount = lyrics.lines.reduce((count, line) => (
    count + (line.romanization && JYUTPING_RE.test(line.romanization.toLowerCase()) ? 1 : 0)
  ), 0)
  if (nativeJyutpingCount >= 2 && (refined === 'zh' || refined === 'zh-tw' || refined === 'zh-hk' || (!refined && HAN_TEST_RE.test(vocalTexts.join('')))))
    return 'zh-hk'

  return toPronunciationBucket(refined ?? (aiMatchesSource ? aiPronunciation.lang : null))
}

/**
 * 判断当前词源是否需要向后端请求 AI 歌词读音：
 * 只要存在缺失原生读音、具有实质唱词、且在当前策略或偏好下允许生成的行即返回 true
 */
export function canAiPronounceLyrics(
  lyrics: ResolvedLyrics,
  targetLang: LyricTargetLang,
  artists: string[] = [],
  options?: CanAiPronounceOptions,
): boolean {
  if (lyrics.source === 'none' || lyrics.instrumental || lyrics.lines.length === 0)
    return false

  const vocalEntries: { line: LyricLine, text: string }[] = []
  for (const line of lyrics.lines) {
    const vocal = classifyVocalLine(getLyricLineText(line), artists)
    if (vocal && hasPronounceableChar(vocal))
      vocalEntries.push({ line, text: vocal })
  }
  if (vocalEntries.length === 0)
    return false

  if (options?.includeSameLang) {
    return vocalEntries.some(({ line, text }) => !line.romanization?.trim() && isSubstantivePronounceableLine(text))
  }

  const vocalTexts = vocalEntries.map(v => v.text)
  const detectedSong = detectLyricTextLang(vocalTexts)
  const songLang: LyricLang = refineDetectedHanSongLang(detectedSong, vocalTexts) ?? 'other'

  return vocalEntries.some(({ line, text }) => {
    if (line.romanization?.trim())
      return false
    if (!isSubstantivePronounceableLine(text))
      return false
    const lineLang = detectLinePronunciationLang(text, undefined, songLang)
    if (options?.isLangEnabled)
      return options.isLangEnabled(lineLang)
    return !shouldHideSameLangPronunciation(lineLang, targetLang)
  })
}

/**
 * 将 AI 生成/同曲补全的读音合并到无原生读音的歌词行中，并按界面语言与细粒度偏好过滤显示：
 * - 原生已有 romanization 的行保留原生内容与逐字切分，仅在当前行语种被关闭/同语言隐藏时清除
 * - 无原生 romanization 的行从 aiPronunciation 中按 `(bg, occurrence, normalizeForMatch(text))` 匹配填充，
 *   并在逐字词源上按 tokens / span 规则构建 romanizationWords
 */
export function applyPronunciationsAndFilter(
  lyrics: ResolvedLyrics,
  targetLang: LyricTargetLang,
  aiPronunciation: SiteLyricPronunciations | null,
  isLangEnabled?: (lineLang: LyricLang) => boolean,
): ResolvedLyrics {
  if (lyrics.source === 'none' || lyrics.lines.length === 0)
    return lyrics

  const shouldHide = (lineLang: LyricLang) => (
    isLangEnabled ? !isLangEnabled(lineLang) : shouldHideSameLangPronunciation(lineLang, targetLang)
  )

  const aiMatchesSource = aiPronunciation != null && (!aiPronunciation.source || aiPronunciation.source === lyrics.source)
  const aiLookup = new Map<string, SiteLyricPronunciationLine>()
  if (aiMatchesSource) {
    for (const item of aiPronunciation.lines) {
      if (!item.pronunciation?.trim())
        continue
      aiLookup.set(`${Boolean(item.bg)}:${item.occurrence}:${normalizeForMatch(item.text)}`, item)
    }
  }

  const allTexts = lyrics.lines.map(line => getLyricLineText(line)).filter(Boolean)
  const detectedSong = detectLyricTextLang(allTexts)
  const songLang = aiMatchesSource && aiPronunciation.lang
    ? aiPronunciation.lang
    : refineDetectedHanSongLang(detectedSong, allTexts)

  const occCounts = new Map<string, number>()
  let changed = false

  const nextLines = lyrics.lines.map((line): LyricLine => {
    const text = getLyricLineText(line)
    const bg = Boolean(line.isBackground)
    const norm = normalizeForMatch(text)
    const countKey = `${bg}:${norm}`
    const occ = occCounts.get(countKey) ?? 0
    occCounts.set(countKey, occ + 1)

    const aiItem = aiLookup.get(`${bg}:${occ}:${norm}`)
    const nativeRoman = line.romanization?.trim()

    if (nativeRoman) {
      const lineLang = detectLinePronunciationLang(text, nativeRoman, aiItem?.lang ?? songLang)
      if (shouldHide(lineLang)) {
        changed = true
        return { ...line, romanization: undefined, romanizationWords: undefined }
      }
      return line
    }

    const aiRoman = aiItem?.pronunciation?.trim()
    if (!aiRoman)
      return line

    const lineLang = detectLinePronunciationLang(text, aiRoman, aiItem?.lang ?? songLang)
    if (shouldHide(lineLang))
      return line

    const nextRomanWords = lyrics.wordTimed && line.words.length > 0
      ? (buildRomanWordsFromAiTokens(line.words, aiItem?.tokens, aiRoman) ?? undefined)
      : undefined

    changed = true
    return {
      ...line,
      romanization: aiRoman,
      romanizationWords: nextRomanWords,
    }
  })

  return changed ? { ...lyrics, lines: nextLines } : lyrics
}
