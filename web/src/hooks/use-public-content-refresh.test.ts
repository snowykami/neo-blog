import { describe, expect, it, vi } from 'vitest'
import { isPublicContentWrite } from './use-public-content-refresh'

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('前台可见内容的写操作', () => {
  it('发布、改元信息、删除文章 / 页面要清路由缓存', () => {
    expect(isPublicContentWrite({ method: 'put', url: '/post/p/12', data: { id: 12, content: '<p>x</p>', type: 'html' } })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/post/p/12', data: { id: 12, title: '新标题', draftContent: '<p>x</p>' } })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/page/p/3', data: { id: 3, isPrivate: true } })).toBe(true)
    expect(isPublicContentWrite({ method: 'delete', url: '/post/p/12' })).toBe(true)
    expect(isPublicContentWrite({ method: 'post', url: '/page/p' })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/page/p/3/html/versions/5' })).toBe(true)
    expect(isPublicContentWrite({ method: 'post', url: '/post/p/12/revisions/7/restore' })).toBe(true)
  })

  it('分类、标签、置顶与站点配置要清路由缓存', () => {
    expect(isPublicContentWrite({ method: 'put', url: '/post/c/2' })).toBe(true)
    expect(isPublicContentWrite({ method: 'delete', url: '/label/l/9' })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/admin/posts/4/pin' })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/admin/config' })).toBe(true)
    expect(isPublicContentWrite({ method: 'put', url: '/admin/kv/site_info' })).toBe(true)
  })

  it('只改草稿的自动保存、读请求与其他写操作不清', () => {
    expect(isPublicContentWrite({ method: 'put', url: '/post/p/12', data: { id: 12, draftContent: '<p>x</p>', baseDraftVersion: 3 } })).toBe(false)
    expect(isPublicContentWrite({ method: 'put', url: '/page/p/3', data: { id: 3, draft_content: '<p>x</p>', base_draft_version: 3 } })).toBe(false)
    expect(isPublicContentWrite({ method: 'get', url: '/post/p/12' })).toBe(false)
    expect(isPublicContentWrite({ method: 'post', url: '/post/p/12/edit-session' })).toBe(false)
    expect(isPublicContentWrite({ method: 'post', url: '/post/p/12/discard-draft' })).toBe(false)
    expect(isPublicContentWrite({ method: 'put', url: '/like/toggle' })).toBe(false)
    expect(isPublicContentWrite({ method: 'post', url: '/comment/c' })).toBe(false)
    expect(isPublicContentWrite({ method: 'put', url: '/user/u/1' })).toBe(false)
  })
})
