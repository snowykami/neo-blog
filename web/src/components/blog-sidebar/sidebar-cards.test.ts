import type { SiteInfo } from '@/utils/common/siteinfo'
import { describe, expect, it } from 'vitest'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { getSidebarCards, parseSidebarCard } from './sidebar-cards'

const site = (patch: Partial<SiteInfo>): SiteInfo => ({ ...fallbackSiteInfo, ...patch })

describe('侧边栏卡片配置', () => {
  it('未配置时使用默认卡片，并沿用旧的嵌入页面配置', () => {
    expect(getSidebarCards(site({ sidebarIframeUrl: '', sidebarIframeTitle: '' })).map(c => c.type)).toEqual(['about', 'labels', 'hot_posts'])
    expect(getSidebarCards(site({ sidebarIframeUrl: 'https://misskey.example/embed', sidebarIframeTitle: 'Misskey' })).at(-1))
      .toEqual({ type: 'iframe', title: 'Misskey', url: 'https://misskey.example/embed', height: 300 })
    // 显式配置为空列表时不显示任何卡片
    expect(getSidebarCards(site({ sidebarCards: [] }))).toEqual([])
  })

  it('忽略无效卡片，预设卡片去重，保持顺序', () => {
    const cards = getSidebarCards(site({
      sidebarCards: [
        { type: 'latest_posts' },
        { type: 'about' },
        { type: 'about' },
        { type: 'iframe', title: 'x', url: 'javascript:alert(1)', height: 300 },
        { type: 'iframe', title: '', url: 'https://example.com', height: 99999 },
        { type: 'iframe', title: '', url: 'https://example.com/embed' },
        { type: 'component', title: '', name: 'nope', props: {} },
        { type: 'component', title: '', name: 'githubRepo', props: { repo: '../../admin' } },
        { type: 'component', title: '仓库', name: 'githubRepo', props: { repo: 'snowykami/neo-blog' }, version: 1 },
        { type: 'unknown' } as never,
      ],
    }))
    expect(cards).toEqual([
      { type: 'latest_posts' },
      { type: 'about' },
      { type: 'iframe', title: '', url: 'https://example.com/embed', height: 300 },
      { type: 'component', title: '仓库', name: 'githubRepo', props: { repo: 'snowykami/neo-blog' }, version: 1 },
    ])
  })

  it('组件版本高于当前版本时视为无效', () => {
    expect(parseSidebarCard({ type: 'component', title: '', name: 'githubRepo', props: { repo: 'a/b' }, version: 99 })).toBeNull()
    expect(parseSidebarCard({ type: 'component', title: '', name: 'weatherCard', props: {} })).not.toBeNull()
  })
})
