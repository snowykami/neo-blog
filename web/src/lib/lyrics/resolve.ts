import type { PlatformExtraLine, PlatformLyricParsed } from './parse-platform'
import type { LyricLine, LyricRomanWord, ResolvedLyrics } from './types'
import { alignTimedTexts, EXTRA_LYRIC_MAX_OFFSET_MS, getLyricLineText, getLyricLineVocalStart } from './line-utils'
import { alignRomanization, romanWordsFromTimed } from './romanization'
import { EMPTY_LYRICS } from './types'

/**
 * 多来源歌词的选择（见 spec 2.1、2.4，规则参考 StarryPlayer 的 LyricsResolver）：所有来源都请求，按质量选择
 * - 等级：TTML（自定义源 / AMLL）> 平台逐字 > 平台逐行
 * - 同一等级：来源自带的翻译、音译越全越好（各算一项）；仍相同时按 网易云（歌曲自己的平台，时间轴与播放的音频一致）> QQ 音乐 > 酷狗音乐。
 *   结果只升不降：先到的先上屏，更好的来源到达后原地替换
 * - 读者按曲目固定（pin）了来源且该来源有歌词时使用它，否则按质量自动选择
 * - 每个来源缺翻译 / 音译时都向其余平台的歌词借（依次为网易云、QQ 音乐、酷狗音乐，各补缺失的一种）：按时间一对一挂载（宁缺勿错），
 *   含中日文字符的音译行不借（多为说明文字）；排序只看来源自带的，借来的不算
 */

export type LyricSourceKind = 'ttml' | 'ncm' | 'qq' | 'kugou'

export interface LyricCandidate {
  kind: LyricSourceKind
  lyrics: ResolvedLyrics
}

/** 来源自带的翻译、音译各算一项（0 ~ 2），同一等级时越多越好 */
export function lyricExtras(lyrics: ResolvedLyrics): number {
  return Number(lyrics.lines.some(line => line.translation)) + Number(lyrics.lines.some(line => line.romanization))
}

/** 来源等级，越小越好 */
export function lyricTier(lyrics: ResolvedLyrics): number {
  if (lyrics.source === 'ttml-custom' || lyrics.source === 'ttml-amll')
    return 0
  return lyrics.wordTimed ? 1 : 2
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const BORROW_TIMED_DURATION_TOLERANCE_MS = 1500

function alignExtraLines(baseStarts: number[], extras: PlatformExtraLine[]): Map<number, PlatformExtraLine> {
  const pairs: { offset: number, base: number, extra: number }[] = []
  extras.forEach((extraItem, extra) => {
    baseStarts.forEach((baseStart, base) => {
      const offset = Math.abs(baseStart - extraItem.start)
      if (offset <= EXTRA_LYRIC_MAX_OFFSET_MS)
        pairs.push({ offset, base, extra })
    })
  })
  pairs.sort((a, b) => a.offset - b.offset)
  const usedBase = new Set<number>()
  const usedExtra = new Set<number>()
  const result = new Map<number, PlatformExtraLine>()
  for (const { base, extra } of pairs) {
    if (usedBase.has(base) || usedExtra.has(extra))
      continue
    usedBase.add(base)
    usedExtra.add(extra)
    result.set(base, extras[extra])
  }
  return result
}

function borrowTimedRomanization(line: LyricLine, vocalStart: number, extraLine: PlatformExtraLine): LyricRomanWord[] | undefined {
  if (!extraLine.items?.length || alignRomanization(extraLine.text, line.words))
    return undefined
  const extraEnd = Math.max(...extraLine.items.map(item => item.end))
  const extraDuration = Math.max(0, extraEnd - extraLine.start)
  const lineDuration = Math.max(0, line.end - vocalStart)
  if (Math.abs(extraDuration - lineDuration) > BORROW_TIMED_DURATION_TOLERANCE_MS)
    return undefined
  const delta = vocalStart - extraLine.start
  const shifted = extraLine.items.map((item) => {
    const start = Math.min(line.end, Math.max(vocalStart, item.start + delta))
    const end = Math.min(line.end, Math.max(start, item.end + delta))
    return { text: item.text, start, end }
  })
  return romanWordsFromTimed(shifted, line.words) ?? undefined
}

/** 把平台歌词的翻译 / 音译借给目标歌词（只补缺失的那一种） */
export function borrowExtras(target: ResolvedLyrics, platform: PlatformLyricParsed | null): ResolvedLyrics {
  if (!platform)
    return target
  const needTranslation = !target.lines.some(line => line.translation) && platform.translations.length > 0
  const needRomanization = !target.lines.some(line => line.romanization) && platform.romanizations.length > 0
  if (!needTranslation && !needRomanization)
    return target

  // 以主唱行第一个音节的实际开始时间对齐（行的开始时间可能经过「提前起唱」）
  const mainIndexes = target.lines.flatMap((line, index) => (line.isBackground ? [] : [index]))
  const baseStarts = mainIndexes.map(index => getLyricLineVocalStart(target.lines[index]))
  const translations = needTranslation ? alignTimedTexts(baseStarts, platform.translations) : null
  const romanizations = needRomanization
    ? alignExtraLines(baseStarts, platform.romanizations.filter(item => !CJK_RE.test(item.text)))
    : null

  const lines: LyricLine[] = target.lines.slice()
  mainIndexes.forEach((index, i) => {
    const translation = translations?.get(i)
    const extraRoman = romanizations?.get(i)
    const romanization = extraRoman?.text
    if (translation || romanization) {
      const romanizationWords = lines[index].romanizationWords
        ?? (target.wordTimed && extraRoman ? borrowTimedRomanization(lines[index], baseStarts[i], extraRoman) : undefined)
      lines[index] = {
        ...lines[index],
        translation: lines[index].translation ?? (translation && translation !== getLyricLineText(lines[index]) ? translation : undefined),
        romanization: lines[index].romanization ?? romanization,
        ...(romanizationWords ? { romanizationWords } : {}),
      }
    }
  })
  return { ...target, lines }
}

export interface LyricResolution {
  lyrics: ResolvedLyrics
  kind: LyricSourceKind | null
  candidates: LyricCandidate[]
}

/** 从已到达的候选中选择要显示的歌词；尚未到达（或没有请求）的来源为 null */
export function resolveLyrics({ ttml, ncm, ncmParsed, qq = null, qqParsed = null, kugou = null, kugouParsed = null, pin }: {
  ttml: ResolvedLyrics | null
  ncm: ResolvedLyrics | null
  ncmParsed: PlatformLyricParsed | null
  qq?: ResolvedLyrics | null
  qqParsed?: PlatformLyricParsed | null
  kugou?: ResolvedLyrics | null
  kugouParsed?: PlatformLyricParsed | null
  pin: LyricSourceKind | null
}): LyricResolution {
  const parsed = { ncm: ncmParsed, qq: qqParsed, kugou: kugouParsed }
  const sources = [['ttml', ttml], ['ncm', ncm], ['qq', qq], ['kugou', kugou]] as const
  const ranked = sources
    .filter((item): item is [LyricSourceKind, ResolvedLyrics] => item[1] != null && item[1].lines.length > 0)
    // 先按来源自带的质量排序（排序是稳定的：质量相同时保持 网易云 > QQ 音乐 > 酷狗音乐 的顺序）
    .map(([kind, lyrics]) => ({ kind, lyrics, tier: lyricTier(lyrics), extras: lyricExtras(lyrics) }))
    .sort((a, b) => a.tier - b.tier || b.extras - a.extras)
  // 再向其余平台借缺失的翻译 / 音译
  const candidates: LyricCandidate[] = ranked.map(({ kind, lyrics }) => ({
    kind,
    lyrics: (['ncm', 'qq', 'kugou'] as const).filter(other => other !== kind).map(other => parsed[other]).reduce(borrowExtras, lyrics),
  }))

  const chosen = candidates.find(candidate => candidate.kind === pin) ?? candidates[0]
  if (chosen)
    return { lyrics: chosen.lyrics, kind: chosen.kind, candidates }
  // 没有可显示的歌词：保留平台的「纯音乐」标记
  const instrumental = [ncm, qq, kugou].find(lyrics => lyrics?.instrumental)
  return { lyrics: instrumental ?? EMPTY_LYRICS, kind: null, candidates }
}
