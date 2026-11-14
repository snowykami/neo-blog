import type { LyricTargetLang } from './lyric-language'
import type { LyricLang, LyricLine, LyricRomanWord, LyricWord, ResolvedLyrics } from './types'
import { getLyricLineText } from './line-utils'
import { classifyVocalLine, detectLyricTextLang, normalizeLyricLangTag } from './lyric-language'
import { alignRomanization, romanWordsFromSpans } from './romanization'
import { normalizeForMatch } from './strip-credits'

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
const OTHER_NON_LATIN_RE = /[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}\p{Script=Hebrew}]/u
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

/**
 * 将 AI 返回的逐词读音 tokens 对齐为前端逐字擦除所需的 LyricRomanWord[]：
 * 1. tokens 数量与可发音词元数量严格一致时，一一对应绑定每个 LyricWord 的起止时间
 * 2. 若未提供严格 1-to-1 tokens 且原文全为汉字，按汉字总数与空格分隔音节数尝试均分时间 span 后复用 romanWordsFromSpans
 * 3. 若仍无法严格对齐，最后尝试原生 alignRomanization（日文假名/单字拼音场景），失败则返回 null 整行回退显示
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

/**
 * 判断当前词源是否需要向后端请求 AI 歌词读音：
 * 只要存在缺失原生读音、具有实质唱词、且不会在当前界面语言下被同语言自动隐藏的行即返回 true
 */
export function canAiPronounceLyrics(
  lyrics: ResolvedLyrics,
  targetLang: LyricTargetLang,
  artists: string[] = [],
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

  const vocalTexts = vocalEntries.map(v => v.text)
  const detectedSong = detectLyricTextLang(vocalTexts)
  const songLang: LyricLang = refineDetectedHanSongLang(detectedSong, vocalTexts) ?? 'other'

  return vocalEntries.some(({ line, text }) => {
    if (line.romanization?.trim())
      return false
    if (!isSubstantivePronounceableLine(text))
      return false
    const lineLang = detectLinePronunciationLang(text, undefined, songLang)
    return !shouldHideSameLangPronunciation(lineLang, targetLang)
  })
}

/**
 * 将 AI 生成/同曲补全的读音合并到无原生读音的歌词行中，并按界面语言应用同语言读音自动隐藏规则：
 * - 原生已有 romanization 的行保留原生内容与逐字切分，仅在命中同语言隐藏规则时清除
 * - 无原生 romanization 的行从 aiPronunciation 中按 `(bg, occurrence, normalizeForMatch(text))` 匹配填充，
 *   并在逐字词源上按 tokens / span 规则构建 romanizationWords
 */
export function applyPronunciationsAndFilter(
  lyrics: ResolvedLyrics,
  targetLang: LyricTargetLang,
  aiPronunciation: SiteLyricPronunciations | null,
): ResolvedLyrics {
  if (lyrics.source === 'none' || lyrics.lines.length === 0)
    return lyrics

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
      if (shouldHideSameLangPronunciation(lineLang, targetLang)) {
        changed = true
        return { ...line, romanization: undefined, romanizationWords: undefined }
      }
      return line
    }

    const aiRoman = aiItem?.pronunciation?.trim()
    if (!aiRoman)
      return line

    const lineLang = detectLinePronunciationLang(text, aiRoman, aiItem?.lang ?? songLang)
    if (shouldHideSameLangPronunciation(lineLang, targetLang))
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
