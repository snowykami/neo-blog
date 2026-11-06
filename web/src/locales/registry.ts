import deepmerge from 'deepmerge'

// 界面语言注册表：只有元信息，不含文案，客户端组件可以直接引用
// 语言代码按 BCP 47 规范写法（语言小写、地区大写，如 zh-TW）；查找时一律不区分大小写

export interface LocaleMeta {
  /** 语言选择器中显示的名称，用该语言自己的写法 */
  name: string
  /** 文案文件名：web/src/locales/{file}.json */
  file: string
  /** 文字（ISO 15924），用于区分简繁：带 zh-Hans / zh-Hant 的标签只匹配同文字的语言 */
  script?: string
  /** 缺少的 key 依次从回退语言补齐；回退链不能成环，最终止于没有 fallback 的语言 */
  fallback?: string
}

export const DEFAULT_LOCALE = 'en'

// 地区变体只写与上一级不同的 key：zh-SG → zh-CN，zh-MO → zh-HK → zh-TW，其余文案沿用上一级
export const LOCALES: Record<string, LocaleMeta> = {
  'en': { name: 'English', file: 'en' },
  'ja': { name: '日本語', file: 'ja', fallback: 'en' },
  'ko': { name: '한국어', file: 'ko', fallback: 'en' },
  'zh-CN': { name: '简体中文（中国）', file: 'zh', script: 'Hans', fallback: 'en' },
  'zh-SG': { name: '简体中文（新加坡）', file: 'zh-sg', script: 'Hans', fallback: 'zh-CN' },
  'zh-TW': { name: '繁體中文（中國台灣）', file: 'zh-tw', script: 'Hant', fallback: 'zh-CN' },
  'zh-HK': { name: '繁體中文（中國香港）', file: 'zh-hk', script: 'Hant', fallback: 'zh-TW' },
  'zh-MO': { name: '繁體中文（中國澳門）', file: 'zh-mo', script: 'Hant', fallback: 'zh-HK' },
}

// 不在注册表里的常见写法（小写）→ 界面语言：旧版本保存的 zh，以及只带文字代码的 zh-Hans / zh-Hant
const LOCALE_ALIASES: Record<string, string> = {
  'zh': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
}

const LOWERCASE_CODES = new Map(Object.keys(LOCALES).map(code => [code.toLowerCase(), code]))

/**
 * 把任意语言标签（用户设置、Accept-Language、navigator.languages）解析为界面语言，不区分大小写，`_` 视同 `-`。
 * 依次尝试完整标签、语言-地区、语言-文字、语言，如 zh-Hant-HK → zh-HK、zh-hant → zh-TW、zh-MY → zh-CN、en-US → en；
 * 标签带文字代码时只接受同文字的语言（zh-Hans-HK → zh-CN）。都不匹配时返回 undefined
 */
export function resolveLocale(tag: string | null | undefined): string | undefined {
  const normalized = (tag ?? '').trim().toLowerCase().replaceAll('_', '-')
  if (!normalized)
    return undefined
  const [language, ...subtags] = normalized.split('-')
  const script = subtags.find(subtag => subtag.length === 4)
  const region = subtags.find(subtag => subtag.length === 2 || /^\d{3}$/.test(subtag))
  const candidates = [normalized, region && `${language}-${region}`, script && `${language}-${script}`, language]
  for (const candidate of candidates) {
    if (!candidate)
      continue
    const code = LOWERCASE_CODES.get(candidate) ?? LOCALE_ALIASES[candidate]
    const codeScript = code && LOCALES[code].script
    if (code && !(script && codeScript && codeScript.toLowerCase() !== script))
      return code
  }
  return undefined
}

/** 解析 Accept-Language，按 q 值从高到低返回语言标签（同权重保持原顺序），忽略 q=0 与通配符 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.split(';').map(item => item.trim())
      const weight = params.find(param => param.startsWith('q='))
      return { tag, q: weight ? Number(weight.slice(2)) : 1, index }
    })
    .filter(item => item.tag && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(item => item.tag)
}

/**
 * 回退链：[自身, 回退语言, 回退语言的回退语言, …]，合并文案时靠前的语言优先。
 * 回退到未注册的语言或形成环时直接抛错，让注册表的错误在启动和测试时暴露
 */
export function getFallbackChain(locale: string, locales: Record<string, LocaleMeta> = LOCALES): string[] {
  const chain: string[] = []
  for (let code: string | undefined = locale; code; code = locales[code].fallback) {
    if (!locales[code])
      throw new Error(`Unknown locale "${code}" in the fallback chain of "${locale}"`)
    if (chain.includes(code))
      throw new Error(`Circular locale fallback: ${[...chain, code].join(' → ')}`)
    chain.push(code)
  }
  return chain
}

// 注册表载入时检查一遍所有回退链，禁止成环
for (const code of Object.keys(LOCALES))
  getFallbackChain(code)

/** 合并回退链上各语言的文案：参数按回退链顺序排列，靠前的语言覆盖靠后的 */
export function mergeLocaleMessages<T extends Record<string, unknown>>(chain: T[]): T {
  return chain.reduceRight<T>((acc, messages) => deepmerge<T>(acc, messages, { arrayMerge: (_, source) => source }), {} as T)
}

/**
 * 界面语言 → 后端接口使用的语言代码（评论翻译、天气地名、AI 人设）：中文只分简繁（zh / zh-tw），其余取主语言
 */
export function toServiceLanguage(locale: string): string {
  const code = resolveLocale(locale) ?? DEFAULT_LOCALE
  if (LOCALES[code].script === 'Hans')
    return 'zh'
  if (LOCALES[code].script === 'Hant')
    return 'zh-tw'
  return code.split('-')[0]
}
