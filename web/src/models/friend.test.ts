import { describe, expect, it } from 'vitest'
import {
  EMPTY_FRIEND_AUTO_META,
  isRelatedFriendUrlHost,
  parseFriendTextSnippet,
  resolveAutofillOptionalFields,
  splitFriendBacklinkAliasesInput,
} from './friend'

describe('parseFriendTextSnippet', () => {
  it('does not let a second feed/rss line hijack out.url', () => {
    const parsed = parseFriendTextSnippet([
      'name: Alice Blog',
      'rss_url: https://alice.example.com/rss.xml',
      'feed_url: https://alice.example.com/atom.xml',
      'url: https://alice.example.com',
    ].join('\n'))

    expect(parsed.name).toBe('Alice Blog')
    expect(parsed.rssUrl).toBe('https://alice.example.com/rss.xml')
    expect(parsed.url).toBe('https://alice.example.com')
  })

  it('parses backlink_url / 回链页面地址 without hijacking out.url', () => {
    const parsed = parseFriendTextSnippet([
      '回链页面地址: https://alice.example.com/friends',
      '站点地址: https://alice.example.com',
      '站点名称: Alice Blog',
      '站点头像: https://alice.example.com/avatar.png',
      '站点简介: 独立博客与代码笔记',
      '站点订阅: https://alice.example.com/feed.xml',
    ].join('\n'))

    expect(parsed.backlinkUrl).toBe('https://alice.example.com/friends')
    expect(parsed.url).toBe('https://alice.example.com')
    expect(parsed.name).toBe('Alice Blog')
    expect(parsed.avatar).toBe('https://alice.example.com/avatar.png')
    expect(parsed.description).toBe('独立博客与代码笔记')
    expect(parsed.rssUrl).toBe('https://alice.example.com/feed.xml')
  })

  it('parses JSON snippets including rss and backlink fields', () => {
    const parsed = parseFriendTextSnippet(JSON.stringify({
      name: 'Bob Site',
      link: 'https://bob.example.org',
      avatar: 'https://bob.example.org/icon.webp',
      descr: 'Hello world',
      feed_url: 'https://bob.example.org/index.xml',
      backlink: 'https://bob.example.org/links',
    }))

    expect(parsed).toEqual({
      name: 'Bob Site',
      url: 'https://bob.example.org',
      avatar: 'https://bob.example.org/icon.webp',
      description: 'Hello world',
      rssUrl: 'https://bob.example.org/index.xml',
      backlinkUrl: 'https://bob.example.org/links',
    })
  })
})

describe('isRelatedFriendUrlHost & resolveAutofillOptionalFields', () => {
  it('isolates multi-tenant hosts like github.io while allowing sibling subdomains on owned domains', () => {
    expect(isRelatedFriendUrlHost('https://bob.github.io/links', 'https://alice.github.io')).toBe(false)
    expect(isRelatedFriendUrlHost('https://alice.github.io/links', 'https://alice.github.io')).toBe(true)
    expect(isRelatedFriendUrlHost('https://rss.alice.co.uk/feed.xml', 'https://blog.alice.co.uk')).toBe(true)
    expect(isRelatedFriendUrlHost('https://bob.co.uk/feed.xml', 'https://alice.co.uk')).toBe(false)
  })

  it('clears stale Site A rssUrl/backlinkUrl/description when re-running autofill for Site B', () => {
    const step1 = resolveAutofillOptionalFields({
      targetUrl: 'https://site-a.example.com',
      current: { description: '', rssUrl: '', backlinkUrl: '' },
      incoming: {
        description: 'Site A tagline',
        rssUrl: 'https://site-a.example.com/feed.xml',
        backlinkUrl: 'https://site-a.example.com/links',
      },
      prevMeta: EMPTY_FRIEND_AUTO_META,
    })

    expect(step1.updates).toEqual({
      description: 'Site A tagline',
      rssUrl: 'https://site-a.example.com/feed.xml',
      backlinkUrl: 'https://site-a.example.com/links',
    })

    const step2 = resolveAutofillOptionalFields({
      targetUrl: 'https://site-b.example.com',
      current: {
        description: 'Site A tagline',
        rssUrl: 'https://site-a.example.com/feed.xml',
        backlinkUrl: 'https://site-a.example.com/links',
      },
      incoming: {
        description: '',
        rssUrl: '',
        backlinkUrl: 'https://site-b.example.com/friends',
      },
      prevMeta: step1.nextMeta,
    })

    expect(step2.updates).toEqual({
      description: '',
      rssUrl: '',
      backlinkUrl: 'https://site-b.example.com/friends',
    })
  })

  it('preserves manual same-site custom rssUrl when autofill finds none on same host', () => {
    const res = resolveAutofillOptionalFields({
      targetUrl: 'https://site-a.example.com',
      current: {
        description: '',
        rssUrl: 'https://site-a.example.com/secret-rss.xml',
        backlinkUrl: '',
      },
      incoming: {
        description: 'Hello',
        rssUrl: '',
        backlinkUrl: 'https://site-a.example.com/links',
      },
      prevMeta: EMPTY_FRIEND_AUTO_META,
    })

    expect(res.updates.rssUrl).toBeUndefined()
    expect(res.updates.backlinkUrl).toBe('https://site-a.example.com/links')
    expect(res.updates.description).toBe('Hello')
  })
})

describe('splitFriendBacklinkAliasesInput', () => {
  it('splits newline, comma, fullwidth comma, semicolon, and space separated hosts cleanly', () => {
    expect(
      splitFriendBacklinkAliasesInput('  sfkm.me, www.sfkm.me，old.sfkm.me;\nportal.sfkm.me  ；  '),
    ).toEqual(['sfkm.me', 'www.sfkm.me', 'old.sfkm.me', 'portal.sfkm.me'])
    expect(splitFriendBacklinkAliasesInput('   \n  ')).toEqual([])
  })

  it('strips URL path/query/hash before splitting so commas or semicolons in pasted URLs do not corrupt tokens', () => {
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me/links?tags=blog,tech')).toEqual([
      'https://www.sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me/links;v=1')).toEqual([
      'https://www.sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me/links?a=1,b=2, sfkm.me')).toEqual([
      'https://www.sfkm.me',
      'sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me,sfkm.me')).toEqual([
      'https://www.sfkm.me',
      'sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me/links,https://sfkm.me/about')).toEqual([
      'https://www.sfkm.me',
      'https://sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('https://www.sfkm.me/links，https://sfkm.me/about')).toEqual([
      'https://www.sfkm.me',
      'https://sfkm.me',
    ])
    expect(splitFriendBacklinkAliasesInput('//example.org')).toEqual(['//example.org'])
    expect(splitFriendBacklinkAliasesInput('http:///example.org')).toEqual(['http://'])
  })
})
