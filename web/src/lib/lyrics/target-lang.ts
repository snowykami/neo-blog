import type { LyricLang } from './types'
import { toServiceLanguage } from '@/locales/registry'

export type LyricTargetLang = Exclude<LyricLang, 'other'>

const SUPPORTED_TARGET_LANGS = new Set<LyricTargetLang>(['zh', 'zh-tw', 'zh-hk', 'en', 'ja', 'ko'])

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
