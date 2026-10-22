import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { getSchema } from '@tiptap/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { repairTagQuotes, restoreMarkTokens, restoreRewriteKeeps, serializeRewriteSelection } from './ai-rewrite-markup'
import { buildPreview, markdownToSlice, resolveAITarget } from './ai-write-utils'

let schema: Schema

beforeAll(() => {
  schema = getSchema(createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }))
})

function parse(html: string): PMNode {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  return PMDOMParser.fromSchema(schema).parse(body)
}

/** 模拟一次润色：按编辑器的真实逻辑由选区得到目标 → 序列化 → 模型输出（默认原样返回）→ 解析、还原占位符 → 写回生成前的文档 */
function rewrite(doc: PMNode, from: number, to: number, model: (markup: string) => string = m => m, final = true) {
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })
  const target = resolveAITarget(state, 'rewrite')!
  const { markup, keeps, marks } = serializeRewriteSelection(doc, schema, target.from, target.to)
  const parsed = markdownToSlice(schema, repairTagQuotes(model(markup)), target.scope, body => restoreMarkTokens(body, marks))
  const slice = restoreRewriteKeeps(parsed, keeps, schema, final)
  return { markup, keeps, marks, target, doc: buildPreview(doc, target, slice).doc }
}

/** 原样往返：模型不做任何修改时，文档必须与生成前完全一致 */
function expectRoundTrip(doc: PMNode, from = 1, to = doc.content.size - 1) {
  const result = rewrite(doc, from, to)
  expect(result.doc.toJSON()).toEqual(doc.toJSON())
  return result
}

/** 文本在文档中的位置（取第一次出现） */
function posOf(doc: PMNode, text: string, offset = 0) {
  let found = -1
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text))
      found = pos + node.text!.indexOf(text) + offset
  })
  return found
}

/** 某个文本块内容的起止位置 */
function blockRange(doc: PMNode, startsWith: string) {
  let range = [-1, -1]
  doc.descendants((node, pos) => {
    if (range[0] < 0 && node.isTextblock && node.textContent.startsWith(startsWith))
      range = [pos + 1, pos + 1 + node.content.size]
  })
  return range as [number, number]
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
    // 带属性的格式以编号标签交给模型，属性不暴露给模型
    expect(markup).not.toContain('data-annotation')
    expect(markup).toMatch(/<m\d+>注释词<\/m\d+>/)
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
    const { markup, target } = expectRoundTrip(doc, from, to)
    expect(target.scope).toBe('inline')
    expect(markup.startsWith('<strong>体文字</strong>')).toBe(true)
  })
})

describe('润色输出的处理', () => {
  it('改写文字时格式随标签保留', () => {
    const doc = parse('<p>这是<strong>重要</strong>的<a href="https://a.dev">文档</a></p>')
    const result = rewrite(doc, 1, doc.content.size - 1, m => m.replace('这是', '这里是').replace('重要', '非常重要').replace('文档', '说明文档'))
    expect(result.doc.toJSON()).toEqual(parse('<p>这里是<strong>非常重要</strong>的<a href="https://a.dev">说明文档</a></p>').toJSON())
  })

  it('模型遗漏或重复占位符时：结束后补回遗漏的节点，重复的只还原一次；生成中不补', () => {
    const doc = parse('<p>前文</p><img src="https://cdn.example.com/a.png"><p>后文</p>')
    const dropped = rewrite(doc, 1, doc.content.size - 1, m => m.replace('[[KEEP_1]]', ''))
    expect(dropped.doc.toJSON()).toEqual(parse('<p>前文</p><p>后文</p><img src="https://cdn.example.com/a.png">').toJSON())

    const streaming = rewrite(doc, 1, doc.content.size - 1, m => m.replace('[[KEEP_1]]', ''), false)
    expect(streaming.doc.toJSON()).toEqual(parse('<p>前文</p><p>后文</p>').toJSON())

    const duplicated = rewrite(doc, 1, doc.content.size - 1, m => `${m}\n\n[[KEEP_1]]\n\n[[KEEP_9]]`)
    expect(duplicated.doc.toJSON()).toEqual(doc.toJSON())
  })

  it('占位符混在文字中时，块节点放到所在段落之后', () => {
    const doc = parse('<p>前文</p><img src="https://cdn.example.com/a.png"><p>后文</p>')
    const merged = rewrite(doc, 1, doc.content.size - 1, () => '前文[[KEEP_1]]\n\n后文')
    expect(merged.doc.toJSON()).toEqual(doc.toJSON())
  })
})

describe('按真实选区润色', () => {
  const annotated = '<p>最开始我其实是不怎么抱有能转正的期望的，毕竟<span data-annotation="指在公司内部通过特殊流程进行转岗">活水</span>过来之前HR就跟我说过一句话 “我们这边暑期转正可能没有这么多<span data-annotation="HC 指的就是 Head Count">HC</span>，转正很激烈”。我去的新组有快将近30个<span data-annotation="以留用为目的的实习">暑期实习</span>生。</p><p>第二段。</p>'

  it('选中整段带注释的段落：作为行内内容序列化，不拆段', () => {
    const doc = parse(annotated)
    const [from, to] = blockRange(doc, '最开始')
    const { markup, keeps, target } = expectRoundTrip(doc, from, to)
    expect(target.scope).toBe('block')
    expect(keeps).toHaveLength(0)
    expect(markup).toContain('<m1>活水</m1>')
    expect(markup).not.toContain('\n')
  })

  it('选中整段后模型改写措辞：注释保留，仍是同一段', () => {
    const doc = parse(annotated)
    const [from, to] = blockRange(doc, '最开始')
    const result = rewrite(doc, from, to, m => m.replace('最开始我其实是不怎么抱有', '起初我并不怎么抱有'))
    expect(result.doc.childCount).toBe(2)
    expect(result.doc.firstChild!.textContent.startsWith('起初我并不怎么抱有')).toBe(true)
    let annotations = 0
    result.doc.firstChild!.descendants((node) => {
      if (node.marks.some(mark => mark.type.name === 'annotation'))
        annotations++
    })
    expect(annotations).toBe(3)
  })

  it('跨两段的部分选区', () => {
    const doc = parse(annotated)
    expectRoundTrip(doc, posOf(doc, '我去的新组'), posOf(doc, '第二段', 2))
  })

  it('跨多个列表项、有序列表从中间开始、列表项内整段、引用内整段', () => {
    const doc = parse('<ul><li><p>第一<strong>项</strong></p></li><li><p>第二项</p></li><li><p>第三项</p></li></ul>'
      + '<ol start="3"><li><p>三</p></li><li><p>四</p></li><li><p>五</p></li></ol>'
      + '<blockquote><p>引用<em>内容</em></p></blockquote><p>结尾</p>')
    expectRoundTrip(doc, posOf(doc, '一'), posOf(doc, '第三', 1))
    const { markup } = expectRoundTrip(doc, posOf(doc, '四'), posOf(doc, '五', 1))
    expect(markup.startsWith('4. ')).toBe(true)
    expectRoundTrip(doc, ...blockRange(doc, '第二项'))
    expectRoundTrip(doc, ...blockRange(doc, '引用'))
  })
})

describe('模型输出的容错', () => {
  it('编号标签的引号与属性不受模型改写影响，标签里的中文引号会被修复', () => {
    const doc = parse('<p>毕竟<span data-annotation="HC 指的就是 Head Count，俗称人头数">HC</span>很少，见<a href="https://a.dev">文档</a>。</p><p style="text-align: center">居中<span style="color: #ef4444">红字</span></p>')
    // 模拟模型把所有英文引号“润色”成中文引号
    const result = rewrite(doc, 1, doc.content.size - 1, m => m.replace(/"([^"]*)"/g, '“$1”'))
    expect(result.doc.toJSON()).toEqual(doc.toJSON())
  })

  it('未知编号的标签只保留文字', () => {
    const doc = parse('<p>前文<span data-annotation="注释">术语</span>后文</p>')
    const [from, to] = blockRange(doc, '前文')
    const result = rewrite(doc, from, to, () => '前文<m9>术语</m9>后文')
    expect(result.doc.toJSON()).toEqual(parse('<p>前文术语后文</p>').toJSON())
  })
})
