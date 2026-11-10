import { describe, expect, it } from 'vitest'
import { languageAlternates, localeAlternates } from './alternates'
import { detectPreferredLocale } from './detect'
import { isConsolePath, isLocalizedHref, LOCALE_PREFIXES, localizePath, routing, splitLocalePrefix } from './routing'

describe('语言路由', () => {
  it('简体中文不带前缀，其余语言用小写前缀', () => {
    expect(routing.defaultLocale).toBe('zh-CN')
    expect(LOCALE_PREFIXES['zh-TW']).toBe('/zh-tw')
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

  it('拆出地址里的语言前缀，不区分大小写', () => {
    expect(splitLocalePrefix('/zh-tw/p/x')).toEqual({ locale: 'zh-TW', pathname: '/p/x' })
    expect(splitLocalePrefix('/zh-TW/p/x')).toEqual({ locale: 'zh-TW', pathname: '/p/x' })
    expect(splitLocalePrefix('/en')).toEqual({ locale: 'en', pathname: '/' })
    expect(splitLocalePrefix('/zh-cn/a')).toEqual({ locale: 'zh-CN', pathname: '/a' })
    expect(splitLocalePrefix('/p/en')).toEqual({ locale: undefined, pathname: '/p/en' })
    expect(splitLocalePrefix('/english')).toEqual({ locale: undefined, pathname: '/english' })
  })

  it('hreflang 列出每种语言并带 x-default，canonical 指向当前语言', () => {
    const languages = languageAlternates('/p/x')
    expect(Object.keys(languages)).toEqual([...routing.locales, 'x-default'])
    expect(languages['x-default']).toBe('/p/x')
    expect(languages['zh-MO']).toBe('/zh-mo/p/x')
    expect(localeAlternates('/', 'en').canonical).toBe('/en')
  })
})

describe('访客偏好语言', () => {
  it('语言 Cookie 优先于浏览器语言', () => {
    expect(detectPreferredLocale({ cookie: 'ja', acceptLanguage: 'en-US,en;q=0.9' })).toBe('ja')
    // 旧版本保存的小写写法也能识别
    expect(detectPreferredLocale({ cookie: 'zh-tw' })).toBe('zh-TW')
  })

  it('按 Accept-Language 权重选第一个支持的语言，都不支持时用 en', () => {
    expect(detectPreferredLocale({ acceptLanguage: 'fr;q=1, zh-Hant-HK;q=0.8, en;q=0.5' })).toBe('zh-HK')
    expect(detectPreferredLocale({ cookie: 'xx', acceptLanguage: 'fr' })).toBe('en')
  })

  it('完全没有偏好（如爬虫）时返回 undefined，由调用方用默认语言', () => {
    expect(detectPreferredLocale({})).toBeUndefined()
    expect(detectPreferredLocale({ cookie: '', acceptLanguage: '  ' })).toBeUndefined()
    expect(detectPreferredLocale({ acceptLanguage: '*' })).toBeUndefined()
  })
})
