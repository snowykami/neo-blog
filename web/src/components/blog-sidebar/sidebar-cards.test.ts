import type { SiteInfo } from '@/utils/common/siteinfo'
import { describe, expect, it } from 'vitest'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { getSidebarCards } from './sidebar-cards'
import { parseSidebarCard } from './sidebar-cards-schema'

const site = (patch: Partial<SiteInfo>): SiteInfo => ({ ...fallbackSiteInfo, ...patch })

describe('侧边栏卡片（运行时整理，不引入文案校验）', () => {
  it('未配置时使用默认卡片，并沿用旧的嵌入页面配置', () => {
    expect(getSidebarCards(site({ sidebarIframeUrl: '', sidebarIframeTitle: '' })).map(c => c.type)).toEqual(['about', 'labels', 'hot_posts'])
    expect(getSidebarCards(site({ sidebarIframeUrl: 'https://misskey.example/embed', sidebarIframeTitle: 'Misskey' })).at(-1))
      .toEqual({ type: 'iframe', title: 'Misskey', url: 'https://misskey.example/embed', height: 300 })
    // 显式配置为空列表时不显示任何卡片
    expect(getSidebarCards(site({ sidebarCards: [] }))).toEqual([])
  })

  it('预设卡片去重、保持顺序，非 http(s) 地址与未知类型丢弃', () => {
    const cards = getSidebarCards(site({
      sidebarCards: [
        { type: 'latest_posts' },
        { type: 'about' },
        { type: 'about' },
        { type: 'iframe', title: 'x', url: 'javascript:alert(1)', height: 300 },
        { type: 'iframe', title: '', url: 'https://example.com', height: 99999 },
        { type: 'iframe', title: '', url: 'https://example.com/embed' },
        { type: 'component', title: '仓库', name: 'githubRepo', props: { repo: 'snowykami/neo-blog' }, version: 1 },
        { type: 'unknown' } as never,
      ],
    }))
    expect(cards).toEqual([
      { type: 'latest_posts' },
      { type: 'about' },
      // 高度越界按上下限截断，而不是整张卡片丢掉
      { type: 'iframe', title: '', url: 'https://example.com', height: 1200 },
      { type: 'iframe', title: '', url: 'https://example.com/embed', height: 300 },
      { type: 'component', title: '仓库', name: 'githubRepo', props: { repo: 'snowykami/neo-blog' }, version: 1 },
    ])
  })

  it('字段缺失时补默认值，结构不对的卡片丢弃', () => {
    const cards = getSidebarCards(site({
      sidebarCards: [
        { type: 'iframe', url: 'https://example.com' },
        { type: 'component', name: 'weatherCard' },
        { type: 'component', name: '  ' },
        { type: 'iframe' } as never,
        null as never,
      ],
    }))
    expect(cards).toEqual([
      { type: 'iframe', title: '', url: 'https://example.com', height: 300 },
      { type: 'component', title: '', name: 'weatherCard', props: {}, version: undefined },
    ])
  })

  it('保存时的校验仍然严格：未知组件、版本过高、非法地址都被拒绝', () => {
    expect(parseSidebarCard({ type: 'component', title: '', name: 'nope', props: {} })).toBeNull()
    expect(parseSidebarCard({ type: 'component', title: '', name: 'githubRepo', props: { repo: '../../admin' } })).toBeNull()
    expect(parseSidebarCard({ type: 'component', title: '', name: 'githubRepo', props: { repo: 'a/b' }, version: 99 })).toBeNull()
    expect(parseSidebarCard({ type: 'iframe', title: '', url: 'javascript:alert(1)', height: 300 })).toBeNull()
    expect(parseSidebarCard({ type: 'iframe', title: '', url: 'https://example.com', height: 99999 })).toBeNull()
    expect(parseSidebarCard({ type: 'unknown' })).toBeNull()
  })

  it('保存时的校验补默认值', () => {
    expect(parseSidebarCard({ type: 'iframe', url: 'https://example.com' }))
      .toEqual({ type: 'iframe', title: '', url: 'https://example.com', height: 300 })
    expect(parseSidebarCard({ type: 'component', title: '', name: 'weatherCard', props: {} })).not.toBeNull()
  })
})
