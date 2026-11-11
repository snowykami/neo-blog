import { describe, expect, it } from 'vitest'
import { getPagePreviewUrl, getPageViewUrl, getPostPreviewUrl, getPostUrl, getPostViewUrl, getTargetViewUrl, getUserUrl, isConsolePreviewPath, withCommentAnchor } from './route'

describe('getPostUrl', () => {
  it('前台地址优先用 slug，不带任何查询参数', () => {
    expect(getPostUrl({ post: { id: 3, slug: 'hello' } })).toBe('/p/hello')
    expect(getPostUrl({ post: { id: 3, slug: null } })).toBe('/p/3')
  })
})

describe('getPostViewUrl', () => {
  it('私密文章只在后台可见，转到后台预览（按 id）', () => {
    expect(getPostViewUrl({ id: 3, slug: 'hello', isPrivate: true })).toBe('/console/posts/preview/3')
    expect(getPostPreviewUrl({ id: 3 })).toBe('/console/posts/preview/3')
  })

  it('公开文章打开前台文章页', () => {
    expect(getPostViewUrl({ id: 3, slug: 'hello', isPrivate: false })).toBe('/p/hello')
  })
})

describe('getPageViewUrl', () => {
  it('私密页面只在后台可见，转到后台预览（按 id）', () => {
    expect(getPageViewUrl({ id: 7, slug: 'about', isPrivate: true })).toBe('/console/pages/preview/7')
    expect(getPagePreviewUrl({ id: 7 })).toBe('/console/pages/preview/7')
  })

  it('公开页面打开前台页面', () => {
    expect(getPageViewUrl({ id: 7, slug: 'about', isPrivate: false })).toBe('/page/about')
    expect(getPageViewUrl({ id: 7, slug: 'about' })).toBe('/page/about')
  })
})

describe('getTargetViewUrl', () => {
  it('按类型与是否私密选择前台或后台预览', () => {
    expect(getTargetViewUrl({ type: 'post', id: 3, slug: 'hello' })).toBe('/p/hello')
    expect(getTargetViewUrl({ type: 'post', id: 3, slug: 'hello', isPrivate: true })).toBe('/console/posts/preview/3')
    expect(getTargetViewUrl({ type: 'page', id: 7, slug: 'about' })).toBe('/page/about')
    expect(getTargetViewUrl({ type: 'page', id: 7, slug: 'about', isPrivate: true })).toBe('/console/pages/preview/7')
  })
})

describe('isConsolePreviewPath', () => {
  it('文章与页面的后台预览不套后台外壳', () => {
    expect(isConsolePreviewPath('/console/posts/preview/3')).toBe(true)
    expect(isConsolePreviewPath('/console/pages/preview/7')).toBe(true)
    expect(isConsolePreviewPath('/console/pages')).toBe(false)
    expect(isConsolePreviewPath('/console/pages/edit/7')).toBe(false)
  })
})

describe('getUserUrl', () => {
  const user = { username: 'leo' }

  it('默认文章标签不带 hash', () => {
    expect(getUserUrl(user)).toBe('/u/leo')
    expect(getUserUrl(user, 'posts')).toBe('/u/leo')
  })

  it('评论与喜欢用 hash 表达，便于从别处直接打开对应标签', () => {
    expect(getUserUrl(user, 'comments')).toBe('/u/leo#comments')
    expect(getUserUrl(user, 'likes')).toBe('/u/leo#likes')
  })
})

describe('withCommentAnchor', () => {
  it('没有评论 id 时原样返回', () => {
    expect(withCommentAnchor('/p/hello')).toBe('/p/hello')
    expect(withCommentAnchor('/p/hello', null)).toBe('/p/hello')
    expect(withCommentAnchor('/p/hello', 0)).toBe('/p/hello')
  })

  it('没有其它参数时用 ? 连接', () => {
    expect(withCommentAnchor('/p/hello', 12)).toBe('/p/hello?comment=12')
  })

  it('地址上已有参数时用 & 连接', () => {
    expect(withCommentAnchor('/p/hello?ref=home', 12)).toBe('/p/hello?ref=home&comment=12')
  })

  it('独立页面同样适用', () => {
    expect(withCommentAnchor('/page/about', 12)).toBe('/page/about?comment=12')
  })
})
