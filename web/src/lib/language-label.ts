'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useCallback } from 'react'

export interface LanguageTranslator {
  (key: string): string
  has: (key: string) => boolean
}

const SONG_LANG_PRIMARY_RE = /^[a-z]{2,3}$/

const INTL_DISPLAY_FALLBACK_CODES: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-HK',
}

/**
 * 将任意语言标签规范化为平台统一的展示用小写 BCP-47 键（如 zh-cn、zh-tw、zh-hk、yue、nan、lzh、en、ja、ko、fr、art、mul）。
 * 无法具体归类的占位值（如 other / und / zxx）返回空字符串。
 */
export function normalizeDisplayLangTag(raw: string | null | undefined): string {
  const tag = (raw ?? '').trim().toLowerCase().replaceAll('_', '-')
  if (!tag || tag.includes('-latn'))
    return ''

  if (tag === 'other' || tag === 'und' || tag === 'zxx' || tag === 'unknown' || tag === 'none')
    return ''
  if (tag === 'mul' || tag === 'multilingual' || tag === 'mixed')
    return 'mul'
  if (tag === 'art' || tag === 'qya' || tag === 'sjn' || tag === 'tlh' || tag === 'conlang' || tag === 'x-conlang')
    return 'art'
  if (tag === 'yue' || tag === 'zh-yue' || tag.startsWith('yue-') || tag.startsWith('zh-yue-'))
    return 'yue'
  if (tag === 'nan' || tag === 'zh-nan' || tag === 'zh-min' || tag === 'zh-min-nan' || tag.startsWith('nan-') || tag.startsWith('zh-nan-') || tag.startsWith('zh-min-') || tag === 'hokkien' || tag === 'taiwanese')
    return 'nan'
  if (tag === 'wuu' || tag === 'zh-wuu' || tag.startsWith('wuu-') || tag.startsWith('zh-wuu-'))
    return 'wuu'
  if (tag === 'hak' || tag === 'zh-hak' || tag === 'zh-hakka' || tag.startsWith('hak-') || tag.startsWith('zh-hak-'))
    return 'hak'
  if (tag === 'lzh' || tag === 'zh-lzh' || tag === 'zh-classical' || tag.startsWith('lzh-') || tag.startsWith('zh-lzh-'))
    return 'lzh'
  if (tag === 'zh-hk' || tag === 'zh-mo' || tag.startsWith('zh-hk-') || tag.startsWith('zh-mo-') || tag === 'zh-hant-hk' || tag === 'zh-hant-mo' || (tag.startsWith('zh-') && (tag.endsWith('-hk') || tag.endsWith('-mo'))))
    return 'zh-hk'
  if (tag === 'zh-tw' || tag.startsWith('zh-tw-') || tag === 'zh-hant' || tag.startsWith('zh-hant-') || tag === 'cmn-hant' || (tag.startsWith('zh-') && (tag.includes('-hant') || tag.endsWith('-tw'))))
    return 'zh-tw'
  if (tag === 'zh' || tag === 'zh-cn' || tag === 'zh-sg' || tag === 'zh-my' || tag.startsWith('zh-cn-') || tag === 'zh-hans' || tag.startsWith('zh-hans-') || tag === 'cmn' || tag === 'cmn-hans' || tag.startsWith('zh-'))
    return 'zh-cn'

  const head = tag.split('-')[0] ?? ''
  switch (head) {
    case 'jp':
      return 'ja'
    case 'kr':
      return 'ko'
    case 'iw':
      return 'he'
    case 'in':
      return 'id'
    case 'ji':
      return 'yi'
    case 'fil':
      return 'tl'
    case 'nb':
    case 'nn':
      return 'no'
  }
  return SONG_LANG_PRIMARY_RE.test(head) ? head : ''
}

/**
 * 格式化标准语言代码为用户当前界面语言下的可读名称：
 * 优先复用 i18n `Language` 词表（保证跨浏览器一致并覆盖方言/古汉语/架空语/多语种），罕见 ISO 语种兜底走 `Intl.DisplayNames`。
 */
export function formatLanguageLabel(
  raw: string | null | undefined,
  locale: string,
  langT?: LanguageTranslator,
): string {
  const code = normalizeDisplayLangTag(raw)
  if (!code)
    return ''
  if (langT?.has(code))
    return langT(code)

  try {
    const intlCode = INTL_DISPLAY_FALLBACK_CODES[code] ?? code
    const resolved = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(intlCode)
    if (resolved && resolved.toLowerCase() !== intlCode.toLowerCase())
      return resolved
  }
  catch {
    // 忽略浏览器不支持的语言标签
  }
  return ''
}

export function useLanguageLabel() {
  const langT = useTranslations('Language')
  const locale = useLocale()
  return useCallback(
    (lang: string | null | undefined) => formatLanguageLabel(lang, locale, langT),
    [langT, locale],
  )
}
