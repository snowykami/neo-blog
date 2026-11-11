import { describe, expect, it } from 'vitest'
import { parseHighlightTerms, splitHighlight } from './highlight'

describe('parseHighlightTerms', () => {
  it('按逗号拆分、去空白去重，长词在前', () => {
    expect(parseHighlightTerms(' neo , neo-blog,,neo ')).toEqual(['neo-blog', 'neo'])
  })

  it('没有搜索词时为空', () => {
    expect(parseHighlightTerms(null)).toEqual([])
    expect(parseHighlightTerms(' , ')).toEqual([])
  })
})

describe('splitHighlight', () => {
  it('不区分大小写地切出命中片段，保留原文大小写', () => {
    expect(splitHighlight('Hello hello World', ['hello'])).toEqual([
      { text: 'Hello', match: true },
      { text: ' ', match: false },
      { text: 'hello', match: true },
      { text: ' World', match: false },
    ])
  })

  it('关键词里的正则特殊字符按字面匹配', () => {
    expect(splitHighlight('a.b axb', ['a.b'])).toEqual([
      { text: 'a.b', match: true },
      { text: ' axb', match: false },
    ])
  })

  it('多个词时长词优先', () => {
    expect(splitHighlight('neo-blog 与 neo', parseHighlightTerms('neo,neo-blog'))).toEqual([
      { text: 'neo-blog', match: true },
      { text: ' 与 ', match: false },
      { text: 'neo', match: true },
    ])
  })

  it('没有关键词时返回整段', () => {
    expect(splitHighlight('中文标题', [])).toEqual([{ text: '中文标题', match: false }])
  })
})
