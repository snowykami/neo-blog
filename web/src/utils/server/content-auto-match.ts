import * as cheerio from 'cheerio'
import {
  ANNOTATION_ATTR,
  AUTO_MATCH_ATTR,
  AUTO_MATCHED_ATTR,
} from '@/components/tiptap-extension/annotation-constants'

interface MatchRule {
  tag: 'a' | 'span'
  attrs: Record<string, string>
}

// 这些位置内的文字不自动匹配：已有链接/注释、代码、标题等
const SKIP_SELECTOR = `a, code, pre, kbd, samp, script, style, textarea, button, h1, h2, h3, h4, h5, h6, [${ANNOTATION_ATTR}]`
const WORD_CHAR = /\w/

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 英文/数字开头或结尾的词语按完整单词匹配（避免 art 匹配到 start），中文直接按字符串匹配
function termPattern(term: string) {
  const start = WORD_CHAR.test(term[0]) ? '(?<!\\w)' : ''
  const end = WORD_CHAR.test(term[term.length - 1]) ? '(?!\\w)' : ''
  return `${start}${escapeRegExp(term)}${end}`
}

function renderMatch(term: string, rule: MatchRule) {
  const attrs = Object.entries({ ...rule.attrs, [AUTO_MATCHED_ATTR]: 'true' })
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ')
  return `<${rule.tag} ${attrs}>${escapeHtml(term)}</${rule.tag}>`
}

/**
 * 渲染时自动匹配：勾选了“自动匹配”的注释/链接，会给正文中其他相同词语加上同样的注释/链接
 * 仅在渲染层处理，不修改存储的文章内容
 */
export function applyContentAutoMatch(html: string): string {
  // 快速路径：没有任何自动匹配词语时不解析
  if (!html.includes(`${AUTO_MATCH_ATTR}="true"`))
    return html

  const $ = cheerio.load(html, null, false)

  // 收集词语，同一词语以文中第一次定义为准
  const rules = new Map<string, MatchRule>()
  $(`a[href][${AUTO_MATCH_ATTR}="true"], span[${ANNOTATION_ATTR}][${AUTO_MATCH_ATTR}="true"]`).each((_, element) => {
    const $element = $(element)
    const term = $element.text().trim()
    if (!term || rules.has(term))
      return
    if (element.tagName === 'a') {
      const attrs: Record<string, string> = { href: $element.attr('href') ?? '' }
      for (const key of ['target', 'rel']) {
        const value = $element.attr(key)
        if (value)
          attrs[key] = value
      }
      rules.set(term, { tag: 'a', attrs })
    }
    else {
      rules.set(term, { tag: 'span', attrs: { [ANNOTATION_ATTR]: $element.attr(ANNOTATION_ATTR) ?? '' } })
    }
  })
  if (rules.size === 0)
    return html

  // 长词优先，避免短词抢先匹配到长词的一部分
  const terms = [...rules.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(terms.map(termPattern).join('|'), 'g')

  $.root().find('*').addBack().contents().filter((_, node) => node.nodeType === 3).each((_, node) => {
    const $node = $(node)
    if ($node.parent().closest(SKIP_SELECTOR).length > 0)
      return
    const text = $node.text()
    pattern.lastIndex = 0
    if (!pattern.test(text))
      return
    pattern.lastIndex = 0
    let result = ''
    let lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      result += escapeHtml(text.slice(lastIndex, match.index)) + renderMatch(match[0], rules.get(match[0])!)
      lastIndex = match.index + match[0].length
    }
    result += escapeHtml(text.slice(lastIndex))
    $node.replaceWith(result)
  })

  return $.html()
}
