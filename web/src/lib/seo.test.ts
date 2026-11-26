import { describe, expect, it } from 'vitest'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import {
  buildPublicPageMetadata,
  buildSeoRobots,
  buildSiteVerification,
  extractVerificationToken,
  normalizeTwitterHandle,
  parseExtraRobotsRules,
  resolveDefaultOgImage,
  resolveDefaultSeoDescription,
  resolveHomeSeoTitle,
} from './seo'

describe('seo helpers', () => {
  it('extracts verification tokens from raw strings and pasted meta tags', () => {
    expect(extractVerificationToken('abc-123_XYZ')).toBe('abc-123_XYZ')
    expect(extractVerificationToken('<meta name="google-site-verification" content="g-token-99" />')).toBe('g-token-99')
    expect(extractVerificationToken('<META NAME="google-site-verification" CONTENT="UPPER-TOKEN" />')).toBe('UPPER-TOKEN')
    expect(extractVerificationToken('<meta name="google-site-verification" />')).toBeUndefined()
    expect(extractVerificationToken('<meta name=\'msvalidate.01\' content=\'bing-token\' >')).toBe('bing-token')
    expect(extractVerificationToken('   ')).toBeUndefined()
  })

  it('normalizes twitter handles from @handle, bare handle, and profile URLs', () => {
    expect(normalizeTwitterHandle('@snowykami')).toBe('@snowykami')
    expect(normalizeTwitterHandle('snowykami')).toBe('@snowykami')
    expect(normalizeTwitterHandle('https://x.com/snowykami')).toBe('@snowykami')
    expect(normalizeTwitterHandle('https://twitter.com/snowykami/status/1')).toBe('@snowykami')
    expect(normalizeTwitterHandle('')).toBeUndefined()
  })

  it('inherits base site metadata when SEO overrides are blank', () => {
    const base = {
      ...fallbackSiteInfo,
      metadata: { ...fallbackSiteInfo.metadata, name: 'Liteyuki Blog', description: 'Base site intro', icon: '/icon.png' },
      owner: { ...fallbackSiteInfo.owner, motto: 'Code & Art' },
      defaultCover: ['/cover-a.webp'],
      seo: { ...fallbackSiteInfo.seo },
    }
    expect(resolveHomeSeoTitle(base)).toBe('Liteyuki Blog - Code & Art')
    expect(resolveDefaultSeoDescription(base)).toBe('Base site intro')
    expect(resolveDefaultOgImage(base)).toBe('/cover-a.webp')

    const overridden = {
      ...base,
      seo: {
        ...base.seo,
        homeTitle: 'Custom Home Title',
        homeDescription: 'Custom Home Description',
        ogImage: '/og-custom.png',
      },
    }
    expect(resolveHomeSeoTitle(overridden)).toBe('Custom Home Title')
    expect(resolveDefaultSeoDescription(overridden)).toBe('Custom Home Description')
    expect(resolveDefaultOgImage(overridden)).toBe('/og-custom.png')
  })

  it('builds verification meta object for Google, Bing, and Baidu', () => {
    expect(buildSiteVerification(fallbackSiteInfo)).toBeUndefined()
    const site = {
      ...fallbackSiteInfo,
      seo: {
        ...fallbackSiteInfo.seo,
        googleVerification: '<meta name="google-site-verification" content="goog123" />',
        bingVerification: 'bing456',
        baiduVerification: 'baidu789',
      },
    }
    expect(buildSiteVerification(site)).toEqual({
      google: 'goog123',
      other: {
        'msvalidate.01': 'bing456',
        'baidu-site-verification': 'baidu789',
      },
    })
  })

  it('computes robots policy for master kill-switch and locale index modes', () => {
    const blocked = {
      ...fallbackSiteInfo,
      seo: { ...fallbackSiteInfo.seo, allowIndexing: false },
    }
    expect(buildSeoRobots('zh', blocked, true)).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    })

    const noindexLocale = {
      ...fallbackSiteInfo,
      seo: { ...fallbackSiteInfo.seo, allowIndexing: true, localeIndexMode: 'noindex_follow' as const },
    }
    expect(buildSeoRobots('zh-CN', noindexLocale)).toEqual({ index: true, follow: true })
    expect(buildSeoRobots('en', noindexLocale)).toEqual({
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    })
  })

  it('converges non-default locale canonical to default locale unless independent mode is set', () => {
    const site = {
      ...fallbackSiteInfo,
      baseUrl: 'https://blog.example.com',
      keywords: ['go', 'nextjs'],
      seo: {
        ...fallbackSiteInfo.seo,
        localeIndexMode: 'canonical_default' as const,
        rssEnabled: false,
        twitterHandle: 'example',
      },
    }
    const meta = buildPublicPageMetadata({
      locale: 'en',
      pathname: '/links',
      siteInfo: site,
      title: 'Friends',
      description: 'Friends directory',
    })
    expect(meta.alternates?.canonical).toBe('/links')
    expect(meta.alternates?.languages).toBeUndefined()
    expect(meta.alternates?.types).toBeUndefined()
    expect(meta.twitter).toMatchObject({ site: '@example', creator: '@example' })

    const independentMeta = buildPublicPageMetadata({
      locale: 'en',
      pathname: '/links',
      siteInfo: {
        ...site,
        seo: { ...site.seo, localeIndexMode: 'independent', rssEnabled: true },
      },
      title: 'Friends',
    })
    expect(independentMeta.alternates?.canonical).toBe('/en/links')
    expect(independentMeta.alternates?.languages?.en).toBe('/en/links')
    expect(independentMeta.alternates?.types).toEqual({ 'application/rss+xml': '/rss.xml' })
  })

  it('parses extra robots.txt directives with comments and multi-agent blocks', () => {
    const parsed = parseExtraRobotsRules(`
      # block internal preview
      Disallow: /preview/
      User-agent: GPTBot
      User-agent: CCBot
      Disallow: /
      Crawl-delay: 10
    `)
    expect(parsed.rootDisallow).toEqual(['/preview/'])
    expect(parsed.groups).toEqual([
      {
        userAgent: ['GPTBot', 'CCBot'],
        disallow: ['/'],
        crawlDelay: 10,
      },
    ])
  })
})
