import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { AITarget } from './ai-write-utils'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { restoreRewriteKeeps, serializeRewriteSelection } from './ai-rewrite-markup'
import { buildPreview, markdownToSlice } from './ai-write-utils'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

function parse(html: string): PMNode {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  return PMDOMParser.fromSchema(schema).parse(body)
}

/** 模拟一次润色：序列化选区 → 模型输出（默认原样返回）→ 解析、还原占位符 → 写回生成前的文档 */
function rewrite(doc: PMNode, from: number, to: number, scope: 'inline' | 'block', model: (markup: string) => string = m => m, final = true) {
  const { markup, keeps } = serializeRewriteSelection(doc, schema, from, to, scope)
  const target: AITarget = { mode: 'rewrite', scope, from, to }
  const slice = restoreRewriteKeeps(markdownToSlice(schema, model(markup), scope), keeps, schema, final)
  return { markup, keeps, doc: buildPreview(doc, target, slice).doc }
}

/** 原样往返：模型不做任何修改时，文档必须与生成前完全一致 */
function expectRoundTrip(doc: PMNode, from = 0, to = doc.content.size, scope: 'inline' | 'block' = 'block') {
  const result = rewrite(doc, from, to, scope)
  expect(result.doc.toJSON()).toEqual(doc.toJSON())
  return result
}

describe('润色选区的原样往返', () => {
  it('保留各类行内格式（含中文标点旁的粗体与 Markdown 特殊字符）', () => {
    const doc = parse(
      '<p>普通<strong>粗体“引号”</strong>中文<em>斜体</em><s>删除</s><code>a*b&lt;c&gt;</code>'
      + '<u>下划线</u><mark data-color="#fde68a" style="background-color: #fde68a">高亮</mark>'
      + '<span style="color: #ef4444">红字</span>H<sub>2</sub>O x<sup>2</sup> '
      + '<a href="https://a.dev" target="_blank" rel="noopener noreferrer nofollow">链接<strong>里的粗体</strong></a>'
      + ' 特殊 *星号* _下划线_ [方括号] \\反斜杠 ~波浪~ |竖线| &amp; 和 &lt;tag&gt;</p>'
      + '<p><span data-annotation="一段注释">注释词</span>与<strong><em>粗斜体</em></strong>，第一行<br>第二行</p>',
    )
    const { markup } = expectRoundTrip(doc)
    // 行内格式以 HTML 标签交给模型，避免 ** 在中文标点旁失效
    expect(markup).toContain('<strong>粗体“引号”</strong>')
    expect(markup).toContain('data-annotation="一段注释"')
    expect(markup).not.toContain('**')
  })

  it('保留块结构：标题、列表、任务列表、引用、分隔线、对齐与容易误认为块语法的段落', () => {
    const doc = parse(
      '<h2>二级标题</h2><h3 style="text-align: center">居中标题</h3>'
      + '<p># 不是标题</p><p>- 不是列表</p><p>1. 不是列表</p><p>&gt; 不是引用</p>'
      + '<p style="text-align: right">右对齐<strong>段落</strong></p>'
      + '<ol start="3"><li><p>第三项</p><ul><li><p>嵌套一</p></li><li><p>嵌套二</p></li></ul></li><li><p>第四项</p></li></ol>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>已完成</p></li><li data-type="taskItem" data-checked="false"><p>未完成</p></li></ul>'
      + '<blockquote><p>引用第一段</p><p>引用第二段</p></blockquote><hr><p>结尾</p>',
    )
    expectRoundTrip(doc)
  })

  it('图片、代码块、表格用占位符保护并原样还原', () => {
    const doc = parse(
      '<p>前文</p><img src="https://cdn.example.com/a.png" alt="示意图">'
      + '<pre><code class="language-go">fmt.Println("**不是粗体**")</code></pre>'
      + '<table><tbody><tr><th><p>表头</p></th></tr><tr><td><p>单元格</p></td></tr></tbody></table>'
      + '<ul><li><p>列表里的代码</p><pre><code>x := 1</code></pre></li></ul><p>后文</p>',
    )
    const { markup, keeps } = expectRoundTrip(doc)
    expect(keeps.map(node => node.type.name)).toEqual(['image', 'codeBlock', 'table', 'codeBlock'])
    expect(markup).toContain('[[KEEP_1]]')
    expect(markup).not.toContain('fmt.Println')
  })

  it('段落中间的部分选区（inline）原样往返', () => {
    const doc = parse('<p>前文<strong>粗体文字</strong>中间<a href="https://a.dev">一个链接</a>后文结尾</p>')
    // 从“粗体”的第 2 个字到“链接”的第 2 个字
    const text = doc.textContent
    const from = 1 + text.indexOf('体文字')
    const to = 1 + text.indexOf('链接') + 1
    const { markup } = expectRoundTrip(doc, from, to, 'inline')
    expect(markup.startsWith('<strong>体文字</strong>')).toBe(true)
  })
})

describe('润色输出的处理', () => {
  it('改写文字时格式随标签保留', () => {
    const doc = parse('<p>这是<strong>重要</strong>的<a href="https://a.dev">文档</a></p>')
    const result = rewrite(doc, 0, doc.content.size, 'block', m => m.replace('这是', '这里是').replace('重要', '非常重要').replace('文档', '说明文档'))
    expect(result.doc.toJSON()).toEqual(parse('<p>这里是<strong>非常重要</strong>的<a href="https://a.dev">说明文档</a></p>').toJSON())
  })

  it('模型遗漏或重复占位符时：结束后补回遗漏的节点，重复的只还原一次；生成中不补', () => {
    const doc = parse('<p>前文</p><img src="https://cdn.example.com/a.png"><p>后文</p>')
    const dropped = rewrite(doc, 0, doc.content.size, 'block', m => m.replace('[[KEEP_1]]', ''))
    expect(dropped.doc.toJSON()).toEqual(parse('<p>前文</p><p>后文</p><img src="https://cdn.example.com/a.png">').toJSON())

    const streaming = rewrite(doc, 0, doc.content.size, 'block', m => m.replace('[[KEEP_1]]', ''), false)
    expect(streaming.doc.toJSON()).toEqual(parse('<p>前文</p><p>后文</p>').toJSON())

    const duplicated = rewrite(doc, 0, doc.content.size, 'block', m => `${m}\n\n[[KEEP_1]]\n\n[[KEEP_9]]`)
    expect(duplicated.doc.toJSON()).toEqual(doc.toJSON())
  })

  it('占位符混在文字中时，块节点放到所在段落之后', () => {
    const doc = parse('<p>前文</p><img src="https://cdn.example.com/a.png"><p>后文</p>')
    const merged = rewrite(doc, 0, doc.content.size, 'block', () => '前文[[KEEP_1]]\n\n后文')
    expect(merged.doc.toJSON()).toEqual(doc.toJSON())
  })
})
