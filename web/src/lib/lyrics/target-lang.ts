import type { LyricLang } from './types'
import { toServiceLanguage } from '@/locales/registry'

export type LyricTargetLang = Exclude<LyricLang, 'other'>

export const SUPPORTED_LYRIC_TARGET_LANGS: readonly LyricTargetLang[] = ['zh', 'zh-tw', 'zh-hk', 'en', 'ja', 'ko']

const SUPPORTED_TARGET_LANGS = new Set<LyricTargetLang>(SUPPORTED_LYRIC_TARGET_LANGS)

/** 把 TTML xml:lang 等 BCP-47 语言标签归一化为 LyricLang；*-Latn 音译标签视为空 */
export function normalizeLyricLangTag(raw?: string | null): LyricLang | null {
  const tag = (raw ?? '').trim().replace(/_/g, '-').toLowerCase()
  if (!tag || tag.includes('-latn'))
    return null
  if (tag === 'zh-hk' || tag === 'zh-mo' || tag.startsWith('zh-hk-') || tag.startsWith('zh-mo-') || tag.endsWith('-hk') || tag.endsWith('-mo'))
    return 'zh-hk'
  if (tag === 'zh-tw' || tag.startsWith('zh-tw-') || tag.endsWith('-tw') || tag.includes('hant'))
    return 'zh-tw'
  if (tag === 'zh' || tag.startsWith('zh-'))
    return 'zh'
  if (tag === 'en' || tag.startsWith('en-'))
    return 'en'
  if (tag === 'ja' || tag.startsWith('ja-') || tag === 'jp')
    return 'ja'
  if (tag === 'ko' || tag.startsWith('ko-') || tag === 'kr')
    return 'ko'
  const head = tag.split('-')[0]
  return head.length >= 2 && head.length <= 3 ? 'other' : null
}

/** 把网站 locale（如 zh-CN / zh-HK / en / ja / ko）转为后端歌词翻译使用的目标语言代码 */
export function toLyricTargetLang(locale: string): LyricTargetLang {
  const direct = normalizeLyricLangTag(locale)
  if (direct && SUPPORTED_TARGET_LANGS.has(direct as LyricTargetLang))
    return direct as LyricTargetLang
  const mapped = toServiceLanguage(locale)
  return SUPPORTED_TARGET_LANGS.has(mapped as LyricTargetLang) ? (mapped as LyricTargetLang) : 'en'
}

export type PronunciationLangBucket = 'zh' | 'zh-hk' | 'en' | 'ja' | 'ko' | 'other'
export type TranslationSongBucket = 'same' | 'zh-classical' | 'mixed' | 'zh' | 'zh-hk' | 'en' | 'ja' | 'ko' | 'other'

/** 将语言标识归入读音偏好分桶（zh 与 zh-tw 统一归入普通话分桶 zh，避免简繁识别前后跳桶） */
export function toPronunciationBucket(lang: string | null | undefined): PronunciationLangBucket {
  if (lang === 'zh' || lang === 'zh-tw' || lang === 'zh-hk' || lang === 'en' || lang === 'ja' || lang === 'ko')
    return lang === 'zh-tw' ? 'zh' : lang
  const norm = normalizeLyricLangTag(lang)
  if (norm === 'zh' || norm === 'zh-tw')
    return 'zh'
  if (norm === 'zh-hk' || norm === 'en' || norm === 'ja' || norm === 'ko')
    return norm
  return 'other'
}

/** 当前界面目标语言下该分桶是否属于“同语种默认隐藏读音”的场景（仅作为默认值，不禁止手动开启） */
export function isSameLangPronunciationBucket(
  bucket: PronunciationLangBucket,
  targetLang: LyricTargetLang,
): boolean {
  if (targetLang === 'zh' || targetLang === 'zh-tw')
    return bucket === 'zh'
  if (targetLang === 'zh-hk')
    return bucket === 'zh-hk'
  if (targetLang === 'en')
    return bucket === 'en'
  return false
}

/** 解析当前界面语言 × 歌曲读音分桶下的发音开关状态 */
export function resolvePronunciationEnabled(
  prefs: Record<string, boolean>,
  targetLang: LyricTargetLang,
  bucket: PronunciationLangBucket | null,
  fallbackShowRomaji: boolean,
): boolean {
  if (bucket == null)
    return fallbackShowRomaji
  const key = `${targetLang}:${bucket}`
  if (typeof prefs[key] === 'boolean')
    return prefs[key]
  if (isSameLangPronunciationBucket(bucket, targetLang))
    return false
  return fallbackShowRomaji
}

/** 解析当前界面语言 × 歌曲翻译分桶下的翻译开关状态 */
export function resolveTranslationEnabled(
  prefs: Record<string, boolean>,
  selectionsByBucket: Record<string, readonly unknown[]>,
  targetLang: LyricTargetLang,
  bucket: TranslationSongBucket | null,
  fallbackShowTranslation: boolean,
): boolean {
  if (bucket == null)
    return fallbackShowTranslation
  const key = `${targetLang}:${bucket}`
  if (typeof prefs[key] === 'boolean')
    return prefs[key]
  if (bucket === 'same')
    return (selectionsByBucket[key]?.length ?? 0) > 0
  return fallbackShowTranslation
}

/** 解析当前界面语言 × 歌曲翻译分桶下的显式语言选择 */
export function resolveBucketSelections<T>(
  selectionsByBucket: Record<string, T[]>,
  targetLang: LyricTargetLang,
  bucket: TranslationSongBucket | null,
  fallbackSelections: T[],
): T[] {
  if (bucket == null)
    return fallbackSelections
  const key = `${targetLang}:${bucket}`
  if (Object.hasOwn(selectionsByBucket, key))
    return selectionsByBucket[key]
  if (bucket === 'same')
    return []
  return fallbackSelections
}
