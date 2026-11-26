import { describe, expect, it } from 'vitest'
import { languageAlternates, localeAlternates } from './alternates'
import { detectPreferredLocale } from './detect'
import { isConsolePath, isLocalizedHref, LOCALE_PREFIXES, localizePath, routing, splitLocalePrefix } from './routing'

describe('语言路由', () => {
  it('简体中文不带前缀，其余语言用小写前缀', () => {
    expect(routing.defaultLocale).toBe('zh-CN')
    expect(LOCALE_PREFIXES['zh-HK']).toBe('/zh-hk')
    expect(LOCALE_PREFIXES['zh-TW']).toBeUndefined()
    expect(LOCALE_PREFIXES['zh-SG']).toBeUndefined()
    expect(LOCALE_PREFIXES['zh-MO']).toBeUndefined()
    expect(LOCALE_PREFIXES.en).toBe('/en')
    expect(localizePath('/p/x', 'zh-CN')).toBe('/p/x')
    expect(localizePath('/p/x', 'en')).toBe('/en/p/x')
    expect(localizePath('/p/x?comment=1#c', 'zh-HK')).toBe('/zh-hk/p/x?comment=1#c')
    expect(localizePath('/', 'ja')).toBe('/ja')
    expect(localizePath('/?label=go', 'ko')).toBe('/ko?label=go')
  })

  it('后台、接口、RSS 与站外地址不加前缀', () => {
    for (const href of ['/console', '/console/posts', '/api/v1/x', '/rss.xml', '/sitemap.xml', 'https://example.com/p/x', '//cdn.example.com/a', '#top', 'relative'])
      expect(localizePath(href, 'en'), href).toBe(href)
    expect(isLocalizedHref('/consoles')).toBe(true)
    expect(isConsolePath('/console')).toBe(true)
    expect(isConsolePath('/console/users')).toBe(true)
    expect(isConsolePath('/consoles')).toBe(false)
  })

  it('拆出地址里的语言前缀，不区分大小写，已移除的地区前缀不再匹配', () => {
    expect(splitLocalePrefix('/zh-hk/p/x')).toEqual({ locale: 'zh-HK', pathname: '/p/x' })
    expect(splitLocalePrefix('/zh-HK/p/x')).toEqual({ locale: 'zh-HK', pathname: '/p/x' })
    expect(splitLocalePrefix('/zh-tw/p/x')).toEqual({ locale: undefined, pathname: '/zh-tw/p/x' })
    expect(splitLocalePrefix('/zh-sg/p/x')).toEqual({ locale: undefined, pathname: '/zh-sg/p/x' })
    expect(splitLocalePrefix('/zh-mo/p/x')).toEqual({ locale: undefined, pathname: '/zh-mo/p/x' })
    expect(splitLocalePrefix('/en')).toEqual({ locale: 'en', pathname: '/' })
    expect(splitLocalePrefix('/zh-cn/a')).toEqual({ locale: 'zh-CN', pathname: '/a' })
    expect(splitLocalePrefix('/p/en')).toEqual({ locale: undefined, pathname: '/p/en' })
    expect(splitLocalePrefix('/english')).toEqual({ locale: undefined, pathname: '/english' })
  })

  it('默认将非默认语言的 canonical 收敛至默认语言；独立索引模式下输出各语言 hreflang 与自身 canonical', () => {
    const languages = languageAlternates('/p/x')
    expect(Object.keys(languages)).toEqual([...routing.locales, 'x-default'])
    expect(languages['x-default']).toBe('/p/x')
    expect(languages['zh-HK']).toBe('/zh-hk/p/x')

    const consolidated = localeAlternates('/p/x', 'en')
    expect(consolidated.canonical).toBe('/p/x')
    expect(consolidated.languages).toBeUndefined()

    const independent = localeAlternates('/', 'en', 'independent')
    expect(independent.canonical).toBe('/en')
    expect(independent.languages?.['x-default']).toBe('/')
  })
})

describe('访客偏好语言', () => {
  it('语言 Cookie 优先于浏览器语言', () => {
    expect(detectPreferredLocale({ cookie: 'ja', acceptLanguage: 'en-US,en;q=0.9' })).toBe('ja')
    // 旧版本保存的 zh-tw / zh-sg Cookie 自动映射到合并后的界面语言
    expect(detectPreferredLocale({ cookie: 'zh-tw' })).toBe('zh-HK')
    expect(detectPreferredLocale({ cookie: 'zh-sg' })).toBe('zh-CN')
  })

  it('按 Accept-Language 权重选第一个支持的语言，都不支持时用 en', () => {
    expect(detectPreferredLocale({ acceptLanguage: 'fr;q=1, zh-Hant-TW;q=0.8, en;q=0.5' })).toBe('zh-HK')
    expect(detectPreferredLocale({ cookie: 'xx', acceptLanguage: 'fr' })).toBe('en')
  })

  it('完全没有偏好（如爬虫）时返回 undefined，由调用方用默认语言', () => {
    expect(detectPreferredLocale({})).toBeUndefined()
    expect(detectPreferredLocale({ cookie: '', acceptLanguage: '  ' })).toBeUndefined()
    expect(detectPreferredLocale({ acceptLanguage: '*' })).toBeUndefined()
  })
})
