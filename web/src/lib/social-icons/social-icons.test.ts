import { describe, expect, it } from 'vitest'
import { searchIcons } from '@/lib/inline-icon/catalog'
import { loadSocialAndLucideCatalog, resolveOwnerIconLabel, resolveOwnerIconSpec } from './resolve'
import { isOwnerLinkIconName, isSafeOwnerLinkUrl } from './types'
import { detectPlatformFromUrl } from './url-detect'

describe('站长社交链接校验与自动识别', () => {
  it('与后端一致校验安全链接协议', () => {
    expect(isSafeOwnerLinkUrl('https://github.com/snowykami')).toBe(true)
    expect(isSafeOwnerLinkUrl('mailto:hi@example.com')).toBe(true)
    expect(isSafeOwnerLinkUrl('tg://resolve?domain=demo')).toBe(true)
    expect(isSafeOwnerLinkUrl('tencent://message/?uin=10001')).toBe(true)
    expect(isSafeOwnerLinkUrl('/rss.xml')).toBe(true)
    expect(isSafeOwnerLinkUrl('/api/v1/file/f/1')).toBe(true)

    expect(isSafeOwnerLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeOwnerLinkUrl('data:text/html,<script>')).toBe(false)
    expect(isSafeOwnerLinkUrl('//evil.example.com')).toBe(false)
    expect(isSafeOwnerLinkUrl('github.com/snowykami')).toBe(false)
    expect(isSafeOwnerLinkUrl('https://example.com/a b')).toBe(false)
  })

  it('校验图标名支持 brand: 前缀与 lucide 图标名', () => {
    expect(isOwnerLinkIconName('brand:github')).toBe(true)
    expect(isOwnerLinkIconName('brand:500px')).toBe(true)
    expect(isOwnerLinkIconName('mail')).toBe(true)
    expect(isOwnerLinkIconName('key-round')).toBe(true)
    expect(isOwnerLinkIconName('Brand:GitHub')).toBe(false)
    expect(isOwnerLinkIconName('brand:')).toBe(false)
  })

  it('根据常见平台地址自动推断图标与标签', () => {
    expect(detectPlatformFromUrl('https://steamcommunity.com/id/demo')).toEqual({ icon: 'brand:steam', label: 'Steam' })
    expect(detectPlatformFromUrl('https://github.com/snowykami')).toEqual({ icon: 'brand:github', label: 'GitHub' })
    expect(detectPlatformFromUrl('https://x.com/demo')).toEqual({ icon: 'brand:x', label: 'X' })
    expect(detectPlatformFromUrl('https://t.me/demo')).toEqual({ icon: 'brand:telegram', label: 'Telegram' })
    expect(detectPlatformFromUrl('tencent://message/?uin=10001')).toEqual({ icon: 'brand:qq', label: 'QQ' })
    expect(detectPlatformFromUrl('https://u.wechat.com/demo')).toEqual({ icon: 'brand:wechat', label: 'WeChat' })
    expect(detectPlatformFromUrl('https://space.bilibili.com/1')).toEqual({ icon: 'brand:bilibili', label: 'Bilibili' })
    expect(detectPlatformFromUrl('mailto:hi@example.com')).toEqual({ icon: 'mail', label: 'Email' })
    expect(detectPlatformFromUrl('/rss.xml')).toEqual({ icon: 'brand:rss', label: 'RSS' })
  })

  it('解析平台图标与 Lucide 图标节点树', async () => {
    const steam = await resolveOwnerIconSpec('brand:steam')
    expect(steam).not.toBeNull()
    expect(steam?.nodes.length).toBeGreaterThan(0)
    expect(await resolveOwnerIconLabel('brand:steam')).toBe('Steam')
    expect(await resolveOwnerIconLabel('brand:wechat')).toBe('微信')

    const mail = await resolveOwnerIconSpec('mail')
    expect(mail?.stroke).toBe(true)
    expect(mail?.nodes.length).toBeGreaterThan(0)
    expect(await resolveOwnerIconSpec('brand:not-exists')).toBeNull()
  })

  it('合并目录支持中英文关键词、简称与前缀优先检索', async () => {
    const catalog = await loadSocialAndLucideCatalog()
    const labels = catalog.categories.map(c => c)
    expect(searchIcons(catalog, 'x', labels)[0]?.name).toBe('brand:x')
    expect(searchIcons(catalog, 'steam', labels)[0]?.name).toBe('brand:steam')
    expect(searchIcons(catalog, 'github', labels)[0]?.name).toBe('brand:github')
    expect(searchIcons(catalog, '微信', labels)[0]?.name).toBe('brand:wechat')
    expect(searchIcons(catalog, 'tg', labels)[0]?.name).toBe('brand:telegram')
    expect(searchIcons(catalog, '电报', labels)[0]?.name).toBe('brand:telegram')
    expect(searchIcons(catalog, 'qq', labels)[0]?.name).toBe('brand:qq')
    expect(searchIcons(catalog, 'facebook', labels)[0]?.name).toBe('brand:facebook')
    expect(searchIcons(catalog, '小红书', labels)[0]?.name).toBe('brand:xiaohongshu')
    expect(searchIcons(catalog, '爱发电', labels)[0]?.name).toBe('brand:afdian')
    expect(searchIcons(catalog, '番组', labels)[0]?.name).toBe('brand:bangumi')
  })
})
