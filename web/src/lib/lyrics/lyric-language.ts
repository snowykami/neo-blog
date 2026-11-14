import type { LyricTargetLang } from './target-lang'
import type { LyricLang, ResolvedLyrics } from './types'
import { getLyricLineText } from './line-utils'
import { isCreditText, normalizeForMatch } from './strip-credits'
import { normalizeLyricLangTag, toLyricTargetLang } from './target-lang'

export { normalizeLyricLangTag, toLyricTargetLang }
export type { LyricTargetLang }

export interface LyricTranslationEntry {
  text: string
  occurrence: number
  bg?: boolean
  translation: string
}

export interface LyricTranslationSet {
  source?: string
  targetLang?: string
  native?: boolean
  sameLanguage?: boolean
  lines: LyricTranslationEntry[]
}

// 繁简高频特征字表（与后端 internal/service/music_translation_lang.go 保持一致）
const TRAD_DISTINCT_CHARS = new Set(Array.from('們這為說時來對會著過還讓給從沒進動發開見經現樣點聽風愛覺夢淚歲聲詞樂車長門問間裡後無東難寫讀語話誰請問謝認識學寫書畫電腦機車飛關總結實際應當應該變變化處總體體萬與業叢嚴喪個豐臨麗舉義樂喬習鄉買亂乾虧雲亞產親億僅僕仍倉儀優價儲兒黨蘭關興養獸內冊寫軍農冠沖決況凍淨準涼減幾鳳憑凱出擊劉則剛創刪別刮到制刷券刺刻劑'))
const SIMP_DISTINCT_CHARS = new Set(Array.from('们这为说时来对会着过还让给从没进动发开见经现样点听风爱觉梦泪岁声词乐车长门问间里后无东难写读语话谁请问谢认识学写书画电脑机车飞关总结实际应当应该变变化处总体体万与业丛严丧个丰临丽举义乐乔习乡买乱干亏云亚产亲亿仅仆仍仓仪优价储儿党兰关兴养兽内册写军农冠冲决况冻净准凉减几凤凭凯出击刘则刚创删别刮到制刷券刺刻剂'))

const ENGLISH_FUNCTION_WORDS = new Set([
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'us',
  'them',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'so',
  'no',
  'not',
  'yes',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'from',
  'by',
  'with',
  'as',
  'up',
  'out',
  'off',
  'down',
  'all',
  'go',
  'come',
  'see',
  'say',
  'let',
  'get',
  'got',
  'put',
  'run',
  'love',
  'like',
  'know',
  'want',
  'need',
  'feel',
  'make',
  'take',
  'time',
  'day',
  'way',
  'now',
  'here',
  'one',
  'two',
  'why',
  'who',
  'how',
  'what',
  'when',
  'where',
  'this',
  'that',
  'im',
  'dont',
  'away',
  'never',
  'just',
])

const INTERJECTION_WORDS = new Set([
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

const SINGER_CUE_ROLES = new Set([
  '男',
  '女',
  '合',
  '合唱',
  '齐',
  '齊',
  '齐唱',
  '齊唱',
  '男声',
  '男聲',
  '女声',
  '女聲',
  '童声',
  '童聲',
  '主唱',
  '伴唱',
  '和声',
  '和聲',
  '独白',
  '獨白',
  '念白',
  '旁白',
  '说唱',
  '說唱',
  'rap',
  'male',
  'female',
  'all',
  'both',
  'chorus',
  'together',
  'vocal',
])

const SECTION_WORDS = new Set([
  'intro',
  'verse',
  'chorus',
  'bridge',
  'outro',
  'prechorus',
  'hook',
  'interlude',
  'solo',
  'instrumental',
  'music',
  'rap',
  'break',
  'ending',
  'coda',
  '前奏',
  '主歌',
  '副歌',
  '间奏',
  '間奏',
  '尾奏',
  '桥段',
  '橋段',
  '独奏',
  '獨奏',
  '伴奏',
  '纯音乐',
  '純音樂',
])

const SECTION_TAG_RE = /^(?:\[[^\]]{1,32}\]|【[^】]{1,32}】|\([^)]{1,32}\)|（[^）]{1,32}）)$/
const INSTRUMENTAL_RE = /纯音乐，请您?欣赏/
const ARTIST_SPLIT_RE = /[/、&,，·+]+/
const PARENS_CLEANUP_RE = /\([^)]*\)|（[^）]*）/g
const PARENS_INNER_RE = /\(([^)]+)\)|（([^）]+)）/g

const RE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const RE_HANGUL = /\p{Script=Hangul}/u
const RE_HAN = /\p{Script=Han}/u
const RE_LATIN = /\p{Script=Latin}/u
const RE_LETTER = /\p{Letter}/u

function countScripts(texts: string[]) {
  let han = 0
  let kana = 0
  let hang = 0
  let latin = 0
  let other = 0
  let trad = 0
  let simp = 0
  const latinWords: string[] = []
  let word = ''

  const flush = () => {
    if (word) {
      latinWords.push(word)
      word = ''
    }
  }

  for (const text of texts) {
    for (const ch of text) {
      if (RE_KANA.test(ch)) {
        flush()
        kana++
      }
      else if (RE_HANGUL.test(ch)) {
        flush()
        hang++
      }
      else if (RE_HAN.test(ch)) {
        flush()
        han++
        if (TRAD_DISTINCT_CHARS.has(ch))
          trad++
        if (SIMP_DISTINCT_CHARS.has(ch))
          simp++
      }
      else if (RE_LATIN.test(ch)) {
        latin++
        word += ch.toLowerCase()
      }
      else if (ch === '\'' || ch === '’') {
        // 合并英文缩写撇号（don't -> dont）
      }
      else if (RE_LETTER.test(ch)) {
        flush()
        other++
      }
      else {
        flush()
      }
    }
    flush()
  }
  return { han, kana, hang, latin, other, trad, simp, latinWords }
}

function detectLatinLang(words: string[]): 'en' | 'other' {
  const hits = new Set<string>()
  for (const word of words) {
    if (ENGLISH_FUNCTION_WORDS.has(word))
      hits.add(word)
  }
  if (hits.size >= 2 || (words.length <= 6 && hits.size >= 1))
    return 'en'
  return 'other'
}

/** 识别一组歌词或译文文本的主要语言（返回 zh / zh-tw / zh-hk / en / ja / ko / other / null） */
export function detectLyricTextLang(texts: string[], explicitTag?: string | null): LyricLang | null {
  const normTag = normalizeLyricLangTag(explicitTag)
  const stats = countScripts(texts)
  const total = stats.han + stats.kana + stats.hang + stats.latin + stats.other
  if (total === 0)
    return normTag
  const cjk = stats.han + stats.kana + stats.hang

  // 先用实际字形交叉校验显式标签，避免上游 xml:lang 标错（如中文歌词标成 ja 或 en）
  switch (normTag) {
    case 'ja':
      if (stats.kana > 0 || (stats.han > 0 && stats.han <= 4 && stats.hang === 0 && stats.latin === 0 && stats.other === 0 && stats.simp === 0))
        return 'ja'
      break
    case 'ko':
      if (stats.hang > 0)
        return 'ko'
      break
    case 'en':
      if (stats.latin > 0 && (cjk === 0 || stats.latin > cjk * 2))
        return 'en'
      break
    case 'other':
      if ((stats.other > 0 || stats.latin > 0) && cjk === 0)
        return 'other'
      break
    case 'zh-tw':
    case 'zh-hk':
      if (stats.kana === 0 && stats.hang === 0 && stats.han > 0) {
        if (stats.simp >= 2 && stats.simp > stats.trad * 2)
          return 'zh'
        return normTag
      }
      break
    case 'zh':
      if (stats.kana === 0 && stats.hang === 0) {
        if (stats.han === 0 && stats.latin > stats.other)
          return detectLatinLang(stats.latinWords)
        if (stats.trad >= 2 && stats.trad > stats.simp * 2)
          return 'zh-tw'
        if (stats.han > 0)
          return 'zh'
      }
      break
  }

  if (stats.kana >= 2 && stats.kana >= Math.max(cjk, 1) * 0.05)
    return 'ja'
  if (stats.hang >= 2 && stats.hang >= total * 0.1)
    return 'ko'
  if (stats.han > 0 && (stats.latin === 0 || stats.han >= stats.latin * 0.15)) {
    if (stats.trad >= 2 && stats.trad > stats.simp * 2)
      return 'zh-tw'
    return 'zh'
  }
  if (stats.latin >= stats.other && stats.latin > 0)
    return detectLatinLang(stats.latinWords)
  if (stats.other > 0)
    return 'other'
  return null
}

function isShortInterjectionLatin(text: string): boolean {
  const stats = countScripts([text])
  if (stats.han + stats.kana + stats.hang + stats.other > 0)
    return false
  const words = stats.latinWords
  if (words.length === 0)
    return true
  if (words.length === 1)
    return Array.from(words[0]).length <= 5 && (INTERJECTION_WORDS.has(words[0]) || !ENGLISH_FUNCTION_WORDS.has(words[0]))

  let allInterjection = true
  let shortOrInterjection = 0
  let hasRepeat = false
  let maxLen = 0
  const uniq = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (ENGLISH_FUNCTION_WORDS.has(w))
      return false
    if (!INTERJECTION_WORDS.has(w))
      allInterjection = false
    const wLen = Array.from(w).length
    if (wLen > maxLen)
      maxLen = wLen
    if (wLen <= 3 || INTERJECTION_WORDS.has(w))
      shortOrInterjection++
    if (i > 0 && w === words[i - 1])
      hasRepeat = true
    uniq.add(w)
  }
  if (allInterjection)
    return true
  const hasHyphen = text.includes('-')
  return words.length >= 3 && (hasRepeat || hasHyphen) && shortOrInterjection * 2 >= words.length && maxLen <= 6 && uniq.size <= words.length - 1
}

function cutLeadingColon(text: string, maxRunes: number): { prefix: string, rest: string } | null {
  const chars = Array.from(text)
  const limit = Math.min(chars.length, maxRunes)
  for (let i = 0; i < limit; i++) {
    if (chars[i] === ':' || chars[i] === '：') {
      return {
        prefix: chars.slice(0, i).join('').trim(),
        rest: chars.slice(i + 1).join('').trim(),
      }
    }
  }
  return null
}

function collectArtistTokens(artists: string[]): Set<string> {
  const tokens = new Set<string>()
  const add = (value: string) => {
    const norm = normalizeForMatch(value)
    if (norm)
      tokens.add(norm)
  }
  for (const artist of artists) {
    add(artist)
    for (const sub of artist.split(ARTIST_SPLIT_RE)) {
      const trimmed = sub.trim()
      add(trimmed)
      const bare = trimmed.replace(PARENS_CLEANUP_RE, '').trim()
      if (bare && Array.from(normalizeForMatch(bare)).length >= 2)
        add(bare)
      for (const m of trimmed.matchAll(PARENS_INNER_RE)) {
        const inner = m[1] ?? m[2] ?? ''
        for (const part of inner.split(ARTIST_SPLIT_RE)) {
          const p = part.trim()
          if (p && Array.from(normalizeForMatch(p)).length >= 2)
            add(p)
        }
      }
    }
  }
  return tokens
}

function isSingerCuePrefix(prefix: string, artistTokens: Set<string>): boolean {
  const clean = prefix.replace(PARENS_CLEANUP_RE, '').trim()
  if (!clean)
    return false
  if (Array.from(clean).length === 1 && clean >= 'A' && clean <= 'F')
    return true
  const parts = clean.split(ARTIST_SPLIT_RE).map(p => p.trim()).filter(Boolean)
  if (parts.length === 0)
    return false
  return parts.every((part) => {
    const norm = normalizeForMatch(part)
    return !norm || SINGER_CUE_ROLES.has(norm) || SINGER_CUE_ROLES.has(part.toLowerCase()) || artistTokens.has(norm)
  }) && parts.some((part) => {
    const norm = normalizeForMatch(part)
    return Boolean(norm && (SINGER_CUE_ROLES.has(norm) || SINGER_CUE_ROLES.has(part.toLowerCase()) || artistTokens.has(norm)))
  })
}

export function isNonLyricCueText(text: string): boolean {
  const trimmed = text.trim()
  const norm = normalizeForMatch(trimmed)
  if (!norm || INSTRUMENTAL_RE.test(trimmed) || isCreditText(trimmed))
    return true
  if (SECTION_WORDS.has(norm))
    return true
  if (SECTION_TAG_RE.test(trimmed)) {
    const clean = norm.replace(/\d+$/, '')
    if (SECTION_WORDS.has(clean) || clean === 'bg')
      return true
    for (const kw of SECTION_WORDS) {
      if (kw.length >= 2 && clean.includes(kw))
        return true
    }
  }
  return false
}

export function classifyVocalLine(text: string, artists: string[] = []): string | null {
  const trimmed = text.trim()
  if (isNonLyricCueText(trimmed))
    return null
  const colon = cutLeadingColon(trimmed, 24)
  if (colon) {
    if (!colon.rest && Array.from(colon.prefix).length <= 16)
      return null
    const tokens = collectArtistTokens(artists)
    if (isSingerCuePrefix(colon.prefix, tokens))
      return isNonLyricCueText(colon.rest) ? null : colon.rest
  }
  return trimmed
}

const CLASSICAL_MODERN_COLLOQUIAL_WORDS = [
  '的',
  '吗',
  '嗎',
  '呢',
  '吧',
  '啦',
  '呀',
  '哇',
  '哦',
  '噢',
  '嘛',
  '呗',
  '唄',
  '哈',
  '嗨',
  '喂',
  '我们',
  '我們',
  '你们',
  '你們',
  '他们',
  '他們',
  '她们',
  '她們',
  '它们',
  '它們',
  '咱们',
  '咱們',
  '什么',
  '什麼',
  '怎么',
  '怎麼',
  '怎样',
  '怎樣',
  '为什么',
  '為什麼',
  '因为',
  '因為',
  '所以',
  '如果',
  '虽然',
  '雖然',
  '但是',
  '可是',
  '而且',
  '已经',
  '已經',
  '正在',
  '曾经',
  '曾經',
  '喜欢',
  '喜歡',
  '觉得',
  '覺得',
  '感觉',
  '感覺',
  '知道',
  '明白',
  '没有',
  '沒有',
  '不是',
  '不会',
  '不會',
  '不能',
  '不要',
  '不用',
  '可以',
  '应该',
  '應該',
  '需要',
  '希望',
  '突然',
  '终于',
  '終於',
  '一直',
  '一起',
  '自己',
  '现在',
  '現在',
  '今天',
  '明天',
  '昨天',
  '这里',
  '這裏',
  '這裡',
  '那里',
  '那裏',
  '哪裡',
  '哪里',
  '这么',
  '這麼',
  '那么',
  '那麼',
  '这儿',
  '這兒',
  '那儿',
  '那兒',
  '了我',
  '了你',
  '了他',
  '了她',
  '了它',
  '了这',
  '了這',
  '了那',
  '好了',
  '算了',
  '走了',
  '忘了',
  '懂了',
  '哭了',
  '笑了',
  '嘅',
  '咗',
  '喺',
  '冇',
  '係',
  '唔',
  '啲',
  '嚟',
  '咁',
  '乜',
  '咩',
  '仲',
  '畀',
  '揾',
  '搵',
  '睇',
  '佢',
  '哋',
]

const CLASSICAL_MODERN_COMPOUNDS_RE = /之[后後前間间中外内內际際旅路歌聲声城光戀恋夜約约一二類类]|[在幾几似關关合超出]乎|不亦[樂乐]乎|[或作讀记歌舞勇智患使學長行]者|也[許许罷罢好是有沒没不想會会]|[其極极尤][實实他它中餘余次]|順其自然|顺其自然|莫名其妙|突如其[來来]|[總总]而言之|[換换]言之|久而久之|[爾尔偶莞]爾|偶尔|乃至|乃是/g

const CLASSICAL_STRONG_CHARS = new Set(Array.from('兮矣焉哉欤歟乎吾汝岂豈毋孰曷盍叵'))
const CLASSICAL_STRONG_PHRASES = [
  '奈何',
  '安得',
  '安能',
  '焉能',
  '岂曰',
  '豈曰',
  '与子',
  '與子',
  '莫道',
  '休道',
  '休言',
  '忽闻',
  '忽聞',
  '惟见',
  '惟見',
  '唯见',
  '唯見',
  '犹抱',
  '猶抱',
  '知否',
  '应是',
  '應是',
  '何事',
  '何必',
  '何似',
  '何须',
  '何須',
  '与君',
  '與君',
  '为君',
  '為君',
  '思君',
  '问君',
  '問君',
  '劝君',
  '勸君',
  '君不见',
  '君不見',
  '归去来',
  '歸去來',
  '嗟乎',
  '呜呼',
  '嗚呼',
  '哀哉',
  '谓之',
  '謂之',
  '之谓',
  '之謂',
  '之所',
  '无乃',
  '無乃',
  '孰能',
  '何尝',
  '何嘗',
  '岂料',
  '豈料',
  '犹记',
  '猶記',
  '曾记',
  '曾記',
  '试问',
  '試問',
  '借问',
  '借問',
  '却道',
  '卻道',
  '恰似',
  '宛若',
  '沦落人',
  '淪落人',
  '相逢何必',
  '曾相识',
  '曾相識',
]
const CLASSICAL_ZHI_PHRASES = [
  '谓之',
  '謂之',
  '求之',
  '失之',
  '得之',
  '听之',
  '聽之',
  '取之',
  '用之',
  '与之',
  '與之',
  '为之',
  '為之',
  '视之',
  '視之',
  '观之',
  '觀之',
  '言之',
  '呼之',
  '往之',
  '之乎',
  '之者',
  '之所以',
  '之谓',
  '之謂',
  '何之',
]
const CLASSICAL_MODERN_PRONOUNS = new Set(Array.from('我你他她它这這那'))
const CLASSICAL_CLAUSE_SPLIT_RE = /[，,。；;！!？?、\s]+/

function analyzeClassicalLine(line: string): { strong: boolean, strictMeter: boolean, modern: boolean, pureHan: boolean } {
  const trimmed = line.trim()
  if (!trimmed)
    return { strong: false, strictMeter: false, modern: false, pureHan: false }
  const stats = countScripts([trimmed])
  if (stats.han < 4 || stats.kana > 0 || stats.hang > 0 || stats.latin > 0 || stats.other > 0)
    return { strong: false, strictMeter: false, modern: false, pureHan: false }

  if (CLASSICAL_MODERN_COLLOQUIAL_WORDS.some(w => trimmed.includes(w)))
    return { strong: false, strictMeter: false, modern: true, pureHan: true }

  const masked = trimmed.replace(CLASSICAL_MODERN_COMPOUNDS_RE, ' ')
  let strong = Array.from(masked).some(ch => CLASSICAL_STRONG_CHARS.has(ch))
  if (!strong)
    strong = CLASSICAL_STRONG_PHRASES.some(phrase => masked.includes(phrase))
  if (!strong && masked.includes('之'))
    strong = CLASSICAL_ZHI_PHRASES.some(phrase => masked.includes(phrase))

  let strictMeter = false
  if (!Array.from(trimmed).some(ch => CLASSICAL_MODERN_PRONOUNS.has(ch))) {
    const clauses = trimmed.split(CLASSICAL_CLAUSE_SPLIT_RE).filter(Boolean)
    if (clauses.length >= 1 && clauses.length <= 4) {
      strictMeter = clauses.every((clause) => {
        const chars = Array.from(clause)
        return (chars.length === 5 || chars.length === 7) && chars.every(ch => RE_HAN.test(ch))
      })
    }
  }
  return { strong, strictMeter, modern: false, pureHan: true }
}

/** 判断中文歌曲是否包含古文/文言文句子（与后端 music_translation_lang.go 一致） */
export function songHasClassicalChinese(vocalLines: string[]): boolean {
  let hanLineCount = 0
  let strongCount = 0
  let strictMeterCount = 0
  let modernLineCount = 0
  for (const line of vocalLines) {
    const res = analyzeClassicalLine(line)
    if (!res.pureHan)
      continue
    hanLineCount++
    if (res.modern) {
      modernLineCount++
      continue
    }
    if (res.strong)
      strongCount++
    if (res.strictMeter)
      strictMeterCount++
  }
  if (hanLineCount === 0)
    return false
  if (strongCount >= 1)
    return true
  return strictMeterCount >= 4 && strictMeterCount * 100 >= hanLineCount * 30 && modernLineCount * 100 < hanLineCount * 25
}

/** 判断有效唱词是否已纯属目标语言；含实质性多语混唱或古文时返回 false（交由 AI 逐行判断） */
export function songAlreadyInTargetLang(vocalLines: string[], targetLang: LyricTargetLang): boolean {
  if (vocalLines.length === 0)
    return true
  const substantive: string[] = []
  let substantiveLatinLines = 0
  let pureHanLines = 0
  let hasKana = false
  let hasHang = false
  let hasHan = false
  let hasOtherScript = false

  for (const raw of vocalLines) {
    const trimmed = raw.trim()
    if (!trimmed || isShortInterjectionLatin(trimmed))
      continue
    const stats = countScripts([trimmed])
    if (stats.han + stats.kana + stats.hang + stats.latin + stats.other === 0)
      continue
    substantive.push(trimmed)
    if (stats.kana > 0)
      hasKana = true
    if (stats.hang > 0)
      hasHang = true
    if (stats.han > 0)
      hasHan = true
    if (stats.other > 0)
      hasOtherScript = true
    if (stats.han > 0 && stats.kana === 0 && stats.hang === 0 && stats.latin === 0 && stats.other === 0 && Array.from(normalizeForMatch(trimmed)).length >= 3)
      pureHanLines++
    if (stats.latin > 0 && stats.han === 0 && stats.kana === 0 && stats.hang === 0 && stats.other === 0)
      substantiveLatinLines++
  }
  if (substantive.length === 0)
    return true

  switch (targetLang) {
    case 'zh':
    case 'zh-tw':
    case 'zh-hk':
      return hasHan && !hasKana && !hasHang && !hasOtherScript && substantiveLatinLines === 0 && !songHasClassicalChinese(substantive)
    case 'ja':
      return hasKana && !hasHang && !hasOtherScript && pureHanLines < 2 && substantiveLatinLines < 2
    case 'ko':
      return hasHang && !hasKana && !hasOtherScript && pureHanLines < 2 && substantiveLatinLines < 2
    case 'en':
      if (hasHan || hasKana || hasHang || hasOtherScript)
        return false
      return detectLyricTextLang(substantive) === 'en'
  }
}

function meaningfulTranslationSamples(lyrics: ResolvedLyrics, pick: (line: ResolvedLyrics['lines'][number]) => string | undefined): string[] {
  const samples: string[] = []
  for (const line of lyrics.lines) {
    const tr = pick(line)?.trim()
    if (!tr || tr === '//')
      continue
    const orig = getLyricLineText(line)
    if (normalizeForMatch(tr) === normalizeForMatch(orig))
      continue
    samples.push(tr)
  }
  return samples
}

function minMeaningfulCount(lyrics: ResolvedLyrics): number {
  const nonEmpty = lyrics.lines.filter(line => getLyricLineText(line).trim().length > 0).length
  return Math.min(2, nonEmpty)
}

function hasKeyedNativeTranslation(lyrics: ResolvedLyrics, targetLang: LyricTargetLang): boolean {
  const minCount = minMeaningfulCount(lyrics)
  if (minCount === 0)
    return false
  const samples = meaningfulTranslationSamples(lyrics, line => line.translationsByLang?.[targetLang])
  if (samples.length < minCount)
    return false
  return detectLyricTextLang(samples, targetLang) === targetLang
}

function hasDefaultNativeTranslation(lyrics: ResolvedLyrics, targetLang: LyricTargetLang): boolean {
  const minCount = minMeaningfulCount(lyrics)
  if (minCount === 0)
    return false
  const samples = meaningfulTranslationSamples(lyrics, line => line.translation)
  if (samples.length < minCount)
    return false
  const tagCounts = new Map<LyricLang, number>()
  for (const line of lyrics.lines) {
    if (line.translationLang && line.translation?.trim())
      tagCounts.set(line.translationLang, (tagCounts.get(line.translationLang) ?? 0) + 1)
  }
  let dominantTag: LyricLang | null = null
  let bestCount = 0
  for (const [tag, count] of tagCounts) {
    if (count > bestCount) {
      dominantTag = tag
      bestCount = count
    }
  }
  return detectLyricTextLang(samples, dominantTag) === targetLang
}

/** 当前歌词源是否已经原生包含符合目标语言要求的翻译（含多语 TTML 的分语言轨道） */
export function hasNativeTargetTranslation(lyrics: ResolvedLyrics, targetLang: LyricTargetLang): boolean {
  if (lyrics.source === 'none' || lyrics.instrumental || lyrics.lines.length === 0)
    return false
  return hasKeyedNativeTranslation(lyrics, targetLang) || hasDefaultNativeTranslation(lyrics, targetLang)
}

/** 判断这首歌在当前目标语言下是否可以启用 AI 歌词翻译（缺失目标语言原生译文且非纯目标语言歌曲） */
export function canAiTranslateLyrics(lyrics: ResolvedLyrics, targetLang: LyricTargetLang, artists: string[] = []): boolean {
  if (lyrics.source === 'none' || lyrics.instrumental || lyrics.lines.length === 0)
    return false
  if (hasNativeTargetTranslation(lyrics, targetLang))
    return false
  const vocalLines = lyrics.lines
    .map(line => classifyVocalLine(getLyricLineText(line), artists))
    .filter((line): line is string => line != null)
  if (vocalLines.length === 0)
    return false
  return !songAlreadyInTargetLang(vocalLines, targetLang)
}

/** 按当前界面目标语言与已就绪的 AI 翻译合成展示用译文；跨语言内置译文在对应语言尚未就绪时隐藏 */
export function applyLanguageTranslations(
  lyrics: ResolvedLyrics,
  targetLang: LyricTargetLang,
  ai: LyricTranslationSet | null,
): ResolvedLyrics {
  if (lyrics.source === 'none' || lyrics.lines.length === 0)
    return lyrics

  if (hasKeyedNativeTranslation(lyrics, targetLang)) {
    return {
      ...lyrics,
      lines: lyrics.lines.map((line) => {
        const next = line.translationsByLang?.[targetLang]
        return next === line.translation ? line : { ...line, translation: next }
      }),
    }
  }

  if (hasDefaultNativeTranslation(lyrics, targetLang))
    return lyrics

  if (ai && ai.source === lyrics.source && ai.targetLang === targetLang) {
    if (ai.native)
      return lyrics
    const lookup = new Map<string, string>()
    for (const item of ai.lines) {
      if (!item.translation)
        continue
      lookup.set(`${Boolean(item.bg)}:${item.occurrence}:${normalizeForMatch(item.text)}`, item.translation)
    }
    const occCounts = new Map<string, number>()
    const nextLines = lyrics.lines.map((line) => {
      const bg = Boolean(line.isBackground)
      const norm = normalizeForMatch(getLyricLineText(line))
      const countKey = `${bg}:${norm}`
      const occ = occCounts.get(countKey) ?? 0
      occCounts.set(countKey, occ + 1)
      const next = lookup.get(`${bg}:${occ}:${norm}`)
      return next === line.translation ? line : { ...line, translation: next }
    })
    return { ...lyrics, lines: nextLines }
  }

  // 未命中所选语言原生翻译且 AI 翻译尚未就绪时，清除其他语言的内置翻译，避免展示错位语种（如日文界面出现简体中文）
  if (!lyrics.lines.some(line => line.translation !== undefined))
    return lyrics
  return {
    ...lyrics,
    lines: lyrics.lines.map(line => (line.translation === undefined ? line : { ...line, translation: undefined })),
  }
}
