import { describe, expect, it } from 'vitest'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import {
  buildContentMetaDescription,
  buildPublicPageMetadata,
  buildRobotsTxtContent,
  buildSeoRobots,
  buildSiteVerification,
  extractVerificationToken,
  normalizeTwitterHandle,
  parseExtraRobotsRules,
  resolveDefaultOgImage,
  resolveDefaultSeoDescription,
  resolveHomeSeoDescription,
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

  it('generates RFC 9309 / Lighthouse-compliant robots.txt output', () => {
    expect(buildRobotsTxtContent({ allowIndexing: false, baseUrl: 'https://blog.example.com' }))
      .toBe('User-agent: *\nDisallow: /\n')

    const txt = buildRobotsTxtContent({
      baseUrl: 'https://blog.example.com/',
      allowIndexing: true,
      sitemapEnabled: true,
      robotsExtraRules: 'Disallow: private-drafts\nUser-agent: GPTBot\nDisallow: /',
    })
    expect(txt).toContain('User-agent: *\nAllow: /\nAllow: /_next/\nDisallow: /console/\nDisallow: /auth/')
    expect(txt).toContain('Disallow: /*?source=')
    expect(txt).toContain('Disallow: /*?p=')
    expect(txt).toContain('Disallow: /private-drafts')
    expect(txt).toContain('User-agent: GPTBot\nDisallow: /')
    expect(txt).toContain('Sitemap: https://blog.example.com/sitemap.xml\n')
  })

  it('expands short default homepage descriptions while preserving explicit SEO overrides', () => {
    const shortSite = {
      ...fallbackSiteInfo,
      metadata: { ...fallbackSiteInfo.metadata, name: 'sfkm', description: '写东西和记录的地方' },
      owner: { ...fallbackSiteInfo.owner, motto: '' },
      seo: { ...fallbackSiteInfo.seo, homeDescription: '' },
    }
    const expanded = resolveHomeSeoDescription(shortSite, 'sfkm 的最新公开文章、技术笔记与日常创作记录。')
    expect(expanded).toBe('写东西和记录的地方，sfkm 的最新公开文章、技术笔记与日常创作记录。')

    const explicitSite = {
      ...shortSite,
      seo: { ...shortSite.seo, homeDescription: '自定义首页描述' },
    }
    expect(resolveHomeSeoDescription(explicitSite, 'sfkm 的最新公开文章、技术笔记与日常创作记录。')).toBe('自定义首页描述')
  })

  it('extracts clean content meta descriptions without mid-quote or heading-prefix cuts', () => {
    // 手写摘要优先保留
    expect(buildContentMetaDescription({
      description: '**手写摘要**内容',
      excerpt: '正文内容很长很长',
      title: '标题',
    })).toBe('手写摘要内容')

    // 剥离重复标题与 Markdown 标题前缀，并在 80–155 字区间内的句号处自然收尾，不断在半个左引号 “
    const body = `# 文章标题\n\n这是一段用于测试自动摘要提取质量的正文内容，我们需要确保当正文超过八十个字符时能够优先在完整的句号处自然收尾，而不是在后面一句话刚写出半个引号的时候硬生生截断。正如作者在后文写道：“这段话已经超过了第一百五十个字符的边界所以不应该留下一半左引号`
    const extracted = buildContentMetaDescription({
      description: '',
      excerpt: body,
      title: '文章标题',
    })
    expect(extracted.startsWith('文章标题')).toBe(false)
    expect(extracted.endsWith('。')).toBe(true)
    expect(extracted.includes('“')).toBe(false)
    expect(Array.from(extracted).length).toBeGreaterThanOrEqual(70)
    expect(Array.from(extracted).length).toBeLessThanOrEqual(155)

    // 未闭合引号内部含句号且总长超过 maxLen 时，仍回退到未闭合左引号之前的完整句号收尾
    const nestedUnclosed = `${'这是一段超过六十个字符的前置技术背景导语，详细说明了现代前端渲染架构在弱网移动设备上的性能瓶颈与优化目标。'}正如某位工程师在长篇演讲中所言：“组件应当是纯粹的状态投影函数。然而在超长下文里这句话一直到两百字之后才闭合引号所以这里绝对不能把左引号留下来`
    const cleanNested = buildContentMetaDescription({ excerpt: nestedUnclosed })
    expect(cleanNested.includes('“')).toBe(false)
    expect(cleanNested.endsWith('。')).toBe(true)

    // 从 HTML 提取时不因 <strong> / <a> 行内标签在中文词间插入多余空格，也不泄漏带 `>` 的属性值
    const fromHtml = buildContentMetaDescription({
      contentHtml: '<div data-expr="a > b"><p>这是一篇<strong>非常重要</strong>的<a href="/x">架构设计</a>总结。</p></div>',
    })
    expect(fromHtml).toBe('这是一篇非常重要的架构设计总结。')
  })
})
