import { describe, expect, it } from 'vitest'
import { resolveMentions } from './mention'

const zhang = { id: 1, username: 'zhang', nickname: '小张' }
const li = { id: 2, username: 'li', nickname: '小李' }

function joined(segments: ReturnType<typeof resolveMentions>) {
  return segments.map(segment => segment.type === 'text' ? segment.text : `@${segment.username}`).join('')
}

describe('resolveMentions', () => {
  it('名字没变时逐个对上', () => {
    const segments = resolveMentions('同意 @zhang 和 @li 的说法', [zhang, li])
    expect(segments.filter(s => s.type === 'mention').map(s => s.username)).toEqual(['zhang', 'li'])
    expect(joined(segments)).toBe('同意 @zhang 和 @li 的说法')
  })

  it('改名后按出现顺序对齐，显示新名字', () => {
    const segments = resolveMentions('同意 @oldzhang 的说法', [{ id: 1, username: 'zhang', nickname: '' }])
    const mentions = segments.filter(s => s.type === 'mention')
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({ id: 1, username: 'zhang' })
    expect(joined(segments)).toBe('同意 @zhang 的说法')
  })

  it('手打的 @ 对不上号时当普通文本，名单里的名字照常链接', () => {
    const segments = resolveMentions('@someone @zhang 你好', [zhang])
    expect(segments.filter(s => s.type === 'mention').map(s => s.username)).toEqual(['zhang'])
    expect(joined(segments)).toBe('@someone @zhang 你好')
  })

  it('对不上号又无法按顺序对齐时，宁可不链接', () => {
    // 名单里两个人，正文里只有一个陌生的 @：数量对不上，无法判断是谁，就不生成链接
    const segments = resolveMentions('@ghost 你好', [zhang, li])
    expect(segments.every(s => s.type === 'text')).toBe(true)
  })

  it('没有提及名单时整段当文本', () => {
    const segments = resolveMentions('@zhang 你好', [])
    expect(segments).toEqual([{ type: 'text', text: '@zhang 你好' }])
  })

  it('邮箱与行内 @ 不算提及', () => {
    const segments = resolveMentions('a@b.com 和 zhang@li', [zhang, li])
    expect(segments.every(s => s.type === 'text')).toBe(true)
  })

  it('行首的 @ 也能识别', () => {
    const segments = resolveMentions('@zhang 你好', [zhang])
    expect(segments[0]).toMatchObject({ type: 'mention', username: 'zhang' })
  })
})
