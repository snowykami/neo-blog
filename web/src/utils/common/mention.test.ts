import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectMentionQuery, highlightMentions, mentionsUser, needsSpaceBeforeMention, resolveMentions } from './mention'

// 与后端 internal/service/comment_mention_test.go 共用同一组边界用例
const boundaryCases: { name: string, content: string, username: string, mentioned: boolean }[] = JSON.parse(
  readFileSync(join(__dirname, '../../../../internal/service/testdata/mention_boundary_cases.json'), 'utf8'),
)

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

describe('mentionsUser（前后端共用用例）', () => {
  it('用例文件不为空', () => {
    expect(boundaryCases.length).toBeGreaterThan(0)
  })

  it.each(boundaryCases)('$name', ({ content, username, mentioned }) => {
    expect(mentionsUser(content, username)).toBe(mentioned)
  })
})

describe('resolveMentions 边界', () => {
  it('句末标点不算进名字', () => {
    const segments = resolveMentions('谢谢 @zhang.', [zhang])
    expect(segments).toEqual([
      { type: 'text', text: '谢谢 ' },
      { type: 'mention', id: 1, username: 'zhang', nickname: '小张' },
      { type: 'text', text: '.' },
    ])
  })

  it('多个名字都能对上时取最长的', () => {
    const dotted = { id: 3, username: 'zhang.san', nickname: '张三' }
    const segments = resolveMentions('@zhang.san 和 @zhang', [zhang, dotted])
    expect(segments.filter(s => s.type === 'mention').map(s => s.username)).toEqual(['zhang.san', 'zhang'])
    expect(joined(segments)).toBe('@zhang.san 和 @zhang')
  })

  it('标点之后的 @ 也能识别', () => {
    const segments = resolveMentions('好的，@zhang', [zhang])
    expect(segments[1]).toMatchObject({ type: 'mention', username: 'zhang' })
  })

  it('改名后按顺序对齐时，句末标点留在正文里', () => {
    const segments = resolveMentions('谢谢 @oldzhang。', [zhang])
    expect(joined(segments)).toBe('谢谢 @zhang。')
  })
})

describe('detectMentionQuery', () => {
  it('行首、空白、标点之后的 @ 开始提及', () => {
    expect(detectMentionQuery('@al', 3)).toEqual({ start: 0, query: 'al' })
    expect(detectMentionQuery('你好 @al', 6)).toEqual({ start: 3, query: 'al' })
    expect(detectMentionQuery('好的，@al', 6)).toEqual({ start: 3, query: 'al' })
  })

  it('邮箱、前面紧跟文字时不弹候选', () => {
    expect(detectMentionQuery('bob@al', 6)).toBeNull()
    expect(detectMentionQuery('你好@al', 5)).toBeNull()
  })

  it('片段里有空白或光标已离开时不算', () => {
    expect(detectMentionQuery('@al ice', 7)).toBeNull()
    expect(detectMentionQuery('@alice 你好', 9)).toBeNull()
  })

  it('刚输入空 @ 时也返回空查询供即时弹上下文候选', () => {
    expect(detectMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(detectMentionQuery('你好 @', 4)).toEqual({ start: 3, query: '' })
    expect(detectMentionQuery('好的，@', 4)).toEqual({ start: 3, query: '' })
  })
})

describe('highlightMentions & needsSpaceBeforeMention', () => {
  it('只高亮已选中名单内的有效 @用户名，手打未选中的保持普通文本且拼接逐字一致', () => {
    const content = '你好 @handtyped，谢谢 @zhang.san 和 @zhang！a@zhang 不算'
    const segments = highlightMentions(content, ['zhang', 'zhang.san'])
    expect(segments.map(s => s.text).join('')).toBe(content)
    expect(segments.filter(s => s.matched).map(s => s.text)).toEqual(['@zhang.san', '@zhang'])
  })

  it('判断是否需要在插入 @ 前补空格', () => {
    expect(needsSpaceBeforeMention('', 0)).toBe(false)
    expect(needsSpaceBeforeMention('你好 ', 3)).toBe(false)
    expect(needsSpaceBeforeMention('好的，', 3)).toBe(false)
    expect(needsSpaceBeforeMention('你好', 2)).toBe(true)
    expect(needsSpaceBeforeMention('abc', 3)).toBe(true)
  })
})
