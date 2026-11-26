import enData from './en.json'
import jaData from './ja.json'
import koData from './ko.json'
import { getFallbackChain, mergeLocaleMessages } from './registry'
import zhHkData from './zh-hk.json'
import zhData from './zh.json'

export { DEFAULT_LOCALE, getFallbackChain, LOCALES, parseAcceptLanguage, resolveLocale, toServiceLanguage } from './registry'

type Messages = Record<string, unknown>

// 各语言自己的文案文件
export const LOCALE_DATA: Record<string, Messages> = {
  'en': enData,
  'ja': jaData,
  'ko': koData,
  'zh-CN': zhData,
  'zh-HK': zhHkData,
}

const mergedMessages = new Map<string, Messages>()

/** 按回退链合并后的完整文案，结果按语言缓存（文案随构建固定，不会变化） */
export function getLocaleMessages(locale: string): Messages {
  let messages = mergedMessages.get(locale)
  if (!messages) {
    messages = mergeLocaleMessages(getFallbackChain(locale).map(code => LOCALE_DATA[code] ?? {}))
    mergedMessages.set(locale, messages)
  }
  return messages
}
