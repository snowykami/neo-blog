import type { IntlError } from 'next-intl'
import { IntlErrorCode } from 'next-intl'
import { getFallbackChain, LOCALES, mergeLocaleMessages } from '@/locales/registry'
import { unitOfPath } from '@/locales/scopes'

/**
 * 文案缺失时的兜底（服务端 i18n/request.ts 与客户端 i18n-scope.client.tsx 共用）
 *
 * 客户端文案按路由作用域裁剪（见 scripts/i18n-scopes.mjs）。清单漏掉某个命名空间时：
 *   1) 先显示由键名转成的可读文本（`load_failed` → `Load failed`），而不是原始键路径
 *   2) 每条键只记一次日志，避免刷屏
 *   3) 客户端再按需加载该语言的完整文案，补上缺的那个下发单元后重新渲染（见 loadMessageUnit）
 */

type Messages = Record<string, unknown>

/** 键名转成可读文本：取最后一段，下划线 / 连字符换成空格，首字母大写 */
export function readableFallback(key: string): string {
  const last = key.split('.').at(-1) ?? key
  const text = last.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key
}

/** 完整路径（命名空间 + 键） */
export function messagePath(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}.${key}` : key
}

const reported = new Set<string>()

/** 文案错误只报一次：缺失文案在生产环境用 warn，其余格式错误等用 error */
export function reportIntlError(error: IntlError, context: string) {
  const id = `${context}\u0000${error.code}\u0000${error.message}`
  if (reported.has(id))
    return
  reported.add(id)
  if (error.code === IntlErrorCode.MISSING_MESSAGE)
    console.warn(`[i18n:${context}] ${error.message}`)
  else
    console.error(`[i18n:${context}] ${error.message}`)
}

// 各语言的完整文案按需加载（单独成块，只在缺文案时才下载）
const LOADERS: Record<string, () => Promise<{ default: Messages }>> = {
  'en': () => import('@/locales/en.json'),
  'ja': () => import('@/locales/ja.json'),
  'ko': () => import('@/locales/ko.json'),
  'zh': () => import('@/locales/zh.json'),
  'zh-sg': () => import('@/locales/zh-sg.json'),
  'zh-tw': () => import('@/locales/zh-tw.json'),
  'zh-hk': () => import('@/locales/zh-hk.json'),
  'zh-mo': () => import('@/locales/zh-mo.json'),
}

/**
 * 加载某条缺失文案所在的下发单元（整棵命名空间，或 Console.<子命名空间>），按回退链合并，
 * 返回只含该单元的文案树（`{ Console: { global: {...} } }`）；该单元在任何语言里都不存在时返回 null
 */
export async function loadMessageUnit(locale: string, path: string): Promise<Messages | null> {
  const unit = unitOfPath(path)
  const segments = unit.split('.')
  const chain = await Promise.all(getFallbackChain(locale).map(async (code) => {
    const loader = LOADERS[LOCALES[code].file]
    const data = loader ? (await loader()).default : {}
    let node: unknown = data
    for (const segment of segments)
      node = node && typeof node === 'object' ? (node as Messages)[segment] : undefined
    if (node === undefined)
      return {}
    const slice: Messages = {}
    let target = slice
    for (const segment of segments.slice(0, -1))
      target = (target[segment] = {}) as Messages
    target[segments.at(-1)!] = node
    return slice
  }))
  const merged = mergeLocaleMessages(chain)
  return Object.keys(merged).length > 0 ? merged : null
}

export function isMissingMessage(error: IntlError) {
  return error.code === IntlErrorCode.MISSING_MESSAGE
}
