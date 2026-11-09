import { describe, expect, it } from 'vitest'
import { getUserUrl, withCommentAnchor } from './route'

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
    expect(withCommentAnchor('/p/hello?type=draft', 12)).toBe('/p/hello?type=draft&comment=12')
  })

  it('独立页面同样适用', () => {
    expect(withCommentAnchor('/page/about', 12)).toBe('/page/about?comment=12')
  })
})
