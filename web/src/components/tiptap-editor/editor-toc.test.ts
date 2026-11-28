import { Schema } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import {
  areHeadingsStructurallyEqual,
  extractEditorHeadings,
  resolveLiveEditorHeading,
  toTocHeadings,
} from './editor-toc'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    blockquote: { group: 'block', content: 'block+' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    componentBlock: {
      group: 'block',
      atom: true,
      attrs: { name: { default: 'callout' } },
    },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true, selectable: false },
    inlineMath: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { latex: { default: '' } },
    },
    inlineIcon: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { name: { default: 'star' } },
    },
  },
})

describe('编辑器目录标题提取与防抖位置解析', () => {
  it('提取 h1–h4 并保留行内公式 LaTeX 与软换行，忽略 h5–h6、空标题及纯图标标题', () => {
    const n = schema.nodes
    const doc = n.doc.create(null, [
      n.heading.create({ level: 1 }, [schema.text('第一章 导论')]),
      n.heading.create({ level: 2 }, [
        schema.text('公式 '),
        n.inlineMath.create({ latex: 'E = mc^2' }),
      ]),
      n.heading.create({ level: 3 }, [n.inlineMath.create({ latex: '\\alpha + \\beta' })]),
      n.heading.create({ level: 4 }, [
        schema.text('多行'),
        n.hardBreak.create(),
        schema.text('小节'),
      ]),
      // 应被忽略的标题
      n.heading.create({ level: 5 }, [schema.text('五级标题不进目录')]),
      n.heading.create({ level: 6 }, [schema.text('六级标题不进目录')]),
      n.heading.create({ level: 2 }, []),
      n.heading.create({ level: 2 }, [schema.text('   ')]),
      n.heading.create({ level: 2 }, [n.inlineIcon.create({ name: 'star' })]),
      // 引用块内标题与前台一致予以保留
      n.blockquote.create(null, [
        n.heading.create({ level: 3 }, [schema.text('引用内标题')]),
      ]),
      n.codeBlock.create(null, [schema.text('# 代码块注释')]),
      n.componentBlock.create({ name: 'callout' }),
    ])

    const raw = extractEditorHeadings(doc)
    expect(raw.map(item => ({ level: item.level, text: item.text }))).toEqual([
      { level: 1, text: '第一章 导论' },
      { level: 2, text: '公式 E = mc^2' },
      { level: 3, text: '\\alpha + \\beta' },
      { level: 4, text: '多行 小节' },
      { level: 3, text: '引用内标题' },
    ])
    // 同一不可变 doc 命中 WeakMap 缓存
    expect(extractEditorHeadings(doc)).toBe(raw)
  })

  it('正文段落编辑导致后续标题 pos 偏移时判定结构相等，避免目录树重渲染', () => {
    const n = schema.nodes
    const docBefore = n.doc.create(null, [
      n.paragraph.create(null, [schema.text('短段落')]),
      n.heading.create({ level: 2 }, [schema.text('核心设计')]),
      n.heading.create({ level: 2 }, [schema.text('性能验证')]),
    ])
    const docAfterBodyEdit = n.doc.create(null, [
      n.paragraph.create(null, [schema.text('这是一段新增了很多字的正文段落内容，使后续所有标题的 pos 发生偏移')]),
      n.heading.create({ level: 2 }, [schema.text('核心设计')]),
      n.heading.create({ level: 2 }, [schema.text('性能验证')]),
    ])

    const rawBefore = extractEditorHeadings(docBefore)
    const tocBefore = toTocHeadings(rawBefore)
    const rawAfter = extractEditorHeadings(docAfterBodyEdit)

    expect(rawAfter[0].pos).toBeGreaterThan(rawBefore[0].pos)
    expect(areHeadingsStructurallyEqual(tocBefore, rawAfter)).toBe(true)

    const docAfterHeadingEdit = n.doc.create(null, [
      n.paragraph.create(null, [schema.text('短段落')]),
      n.heading.create({ level: 2 }, [schema.text('核心设计（新）')]),
      n.heading.create({ level: 2 }, [schema.text('性能验证')]),
    ])
    expect(areHeadingsStructurallyEqual(tocBefore, extractEditorHeadings(docAfterHeadingEdit))).toBe(false)
  })

  it('防抖窗口内旧 pos 已偏移或越界时，点击目录能回退到当前最新 doc 实时定位', () => {
    const n = schema.nodes
    const staleDoc = n.doc.create(null, [
      n.paragraph.create(null, [schema.text('很长的前置内容........................................')]),
      n.heading.create({ level: 2 }, [schema.text('第一节')]),
      n.heading.create({ level: 2 }, [schema.text('第二节')]),
    ])
    const staleRaw = extractEditorHeadings(staleDoc)

    // 用户删掉了前置长段落，旧 pos 甚至超出新 doc 长度
    const shrunkDoc = n.doc.create(null, [
      n.heading.create({ level: 2 }, [schema.text('第一节')]),
      n.heading.create({ level: 2 }, [schema.text('第二节')]),
    ])

    const resolved = resolveLiveEditorHeading(shrunkDoc, 1, staleRaw[1])
    expect(resolved).not.toBeNull()
    expect(resolved?.text).toBe('第二节')
    expect(resolved?.pos).toBe(extractEditorHeadings(shrunkDoc)[1].pos)
  })
})
