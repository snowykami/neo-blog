import type { LocaleMeta } from './registry'
import { describe, expect, it } from 'vitest'
import { getLocaleMessages, LOCALE_DATA } from '.'
import { DEFAULT_LOCALE, getFallbackChain, LOCALES, mergeLocaleMessages, parseAcceptLanguage, resolveLocale, toServiceLanguage } from './registry'

type Messages = Record<string, unknown>

function flatten(messages: Messages, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object')
      flatten(value as Messages, path).forEach((v, k) => out.set(k, v))
    else
      out.set(path, String(value))
  }
  return out
}

// ICU 占位符与富文本标签，地区变体改写用词时不能改动它们
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\s*(\w+)|<\/?(\w+)/g)].map(m => m[1] ?? m[2]).sort()
}

describe('resolveLocale', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh-tw', 'zh-TW'],
    ['ZH_tw', 'zh-TW'],
    ['zh-HK', 'zh-HK'],
    ['zh-MO', 'zh-MO'],
    ['zh-SG', 'zh-SG'],
    ['zh-Hant-HK', 'zh-HK'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-SG', 'zh-TW'],
    ['zh-Hans-HK', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-MY', 'zh-CN'],
    ['en-US', 'en'],
    ['ja-JP', 'ja'],
    ['ko', 'ko'],
  ])('%s → %s', (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected)
  })

  it('不支持的语言返回 undefined', () => {
    expect(resolveLocale('fr-FR')).toBeUndefined()
    expect(resolveLocale('')).toBeUndefined()
    expect(resolveLocale(undefined)).toBeUndefined()
  })
})

describe('parseAcceptLanguage', () => {
  it('按 q 值排序，同权重保持顺序，忽略 q=0 与通配符', () => {
    expect(parseAcceptLanguage('en;q=0.5, zh-TW, *;q=0.1, ja;q=0, zh;q=0.9, ko;q=0.9')).toEqual(['zh-TW', 'zh', 'ko', 'en'])
    expect(parseAcceptLanguage(null)).toEqual([])
  })
})

describe('getFallbackChain', () => {
  it('地区变体逐级回退，所有语言最终回退到默认语言', () => {
    expect(getFallbackChain('zh-MO')).toEqual(['zh-MO', 'zh-HK', 'zh-TW', 'zh-CN', 'en'])
    expect(getFallbackChain('zh-SG')).toEqual(['zh-SG', 'zh-CN', 'en'])
    for (const code of Object.keys(LOCALES))
      expect(getFallbackChain(code).at(-1)).toBe(DEFAULT_LOCALE)
  })

  it('回退链成环或回退到未注册的语言时抛错', () => {
    const cyclic: Record<string, LocaleMeta> = {
      a: { name: 'A', file: 'a', fallback: 'b' },
      b: { name: 'B', file: 'b', fallback: 'c' },
      c: { name: 'C', file: 'c', fallback: 'a' },
    }
    expect(() => getFallbackChain('a', cyclic)).toThrow('Circular locale fallback: a → b → c → a')
    const self: Record<string, LocaleMeta> = { a: { name: 'A', file: 'a', fallback: 'a' } }
    expect(() => getFallbackChain('a', self)).toThrow('Circular')
    const unknown: Record<string, LocaleMeta> = { a: { name: 'A', file: 'a', fallback: 'x' } }
    expect(() => getFallbackChain('a', unknown)).toThrow('Unknown locale "x"')
  })
})

describe('文案文件', () => {
  it('每种界面语言都有对应的文案文件', () => {
    expect(Object.keys(LOCALE_DATA).sort()).toEqual(Object.keys(LOCALES).sort())
  })

  it('合并时靠前的语言覆盖靠后的，缺少的 key 从回退语言补齐', () => {
    expect(mergeLocaleMessages([{ a: { x: '1' } }, { a: { x: '2', y: '2' }, b: '2' }])).toEqual({ a: { x: '1', y: '2' }, b: '2' })
    const hk = flatten(getLocaleMessages('zh-HK'))
    const tw = flatten(getLocaleMessages('zh-TW'))
    expect(hk.get('Route.privacy_policy')).toBe('私隱政策')
    expect(hk.get('Common.search')).toBe(tw.get('Common.search'))
    expect([...hk.keys()].sort()).toEqual([...tw.keys()].sort())
  })

  it('地区变体只覆盖上一级已有的 key，且不改动占位符与标签', () => {
    for (const [code, meta] of Object.entries(LOCALES)) {
      if (!meta.fallback || meta.fallback === DEFAULT_LOCALE)
        continue
      const parent = flatten(getLocaleMessages(meta.fallback))
      for (const [key, value] of flatten(LOCALE_DATA[code])) {
        expect(parent.has(key), `${code}: ${key} 不在 ${meta.fallback} 中`).toBe(true)
        expect(placeholders(value), `${code}: ${key}`).toEqual(placeholders(parent.get(key) ?? ''))
      }
    }
  })
})

describe('toServiceLanguage', () => {
  it.each([
    ['zh-CN', 'zh'],
    ['zh-SG', 'zh'],
    ['zh-TW', 'zh-tw'],
    ['zh-HK', 'zh-tw'],
    ['zh-MO', 'zh-tw'],
    ['en', 'en'],
    ['ja', 'ja'],
    ['zh-tw', 'zh-tw'],
  ])('%s → %s', (locale, expected) => {
    expect(toServiceLanguage(locale)).toBe(expected)
  })
})
