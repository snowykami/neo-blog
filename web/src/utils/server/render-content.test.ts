// @vitest-environment node
import * as cheerio from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import hljs from '@/lib/highlight'
import { CODE_BLOCK_ATTR, CODE_COPY_ATTR } from '@/utils/common/code-block'
import * as renderCodeModule from './render-code'
import { renderContentHtml } from './render-content'

describe('renderContentHtml 正文服务端渲染与缓存', () => {
  it('不同 copyLabel 共用同一份缓存条目，并在返回时按语言替换与转义按钮文案', async () => {
    const spy = vi.spyOn(renderCodeModule, 'renderCodeBlocks')
    const raw = '<h2>小节 __NEO_BLOG_CODE_COPY_LABEL__</h2><pre><code class="language-ts">const s = "__NEO_BLOG_CODE_COPY_LABEL__"</code></pre>'

    const zh = await renderContentHtml(raw, { copyLabel: '复制' })
    const en = await renderContentHtml(raw, { copyLabel: 'Copy' })
    const escaped = await renderContentHtml(raw, { copyLabel: 'Copy <"1">' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(zh.headings).toEqual([{ id: 'heading-小节-__neo_blog_code_copy_label__', text: '小节 __NEO_BLOG_CODE_COPY_LABEL__', level: 2 }])

    const $zh = cheerio.load(zh.html, null, false)
    expect($zh(`[${CODE_COPY_ATTR}]`).text()).toBe('复制')
    expect($zh('h2').text()).toBe('小节 __NEO_BLOG_CODE_COPY_LABEL__')
    expect($zh('pre > code').text()).toBe('const s = "__NEO_BLOG_CODE_COPY_LABEL__"')

    const $en = cheerio.load(en.html, null, false)
    expect($en(`[${CODE_COPY_ATTR}]`).text()).toBe('Copy')
    expect($en('h2').text()).toBe('小节 __NEO_BLOG_CODE_COPY_LABEL__')
    expect($en('pre > code').text()).toBe('const s = "__NEO_BLOG_CODE_COPY_LABEL__"')

    expect(escaped.html).not.toContain('<"1">')
    const $escaped = cheerio.load(escaped.html, null, false)
    expect($escaped(`[${CODE_COPY_ATTR}]`).text()).toBe('Copy <"1">')

    spy.mockRestore()
  })

  it('为正文 <img> 注入 loading="lazy"、decoding="async" 与缺失 alt="" 兜底，并保留已有属性', async () => {
    const raw = [
      '<p><img src="/a.jpg" alt="架构示意图"></p>',
      '<p><img src="/b.jpg" alt="b" loading="eager"></p>',
      '<p><img src="/c.jpg" alt="c" loading="eager" decoding="sync"></p>',
      '<p><img src="/no-alt.jpg" loading="eager" decoding="async"></p>',
      '<p><img src="/empty-alt.jpg" alt=""></p>',
    ].join('')

    const { html } = await renderContentHtml(raw)
    const $ = cheerio.load(html, null, false)
    const imgs = $('img')

    expect(imgs.eq(0).attr('alt')).toBe('架构示意图')
    expect(imgs.eq(0).attr('loading')).toBe('lazy')
    expect(imgs.eq(0).attr('decoding')).toBe('async')

    expect(imgs.eq(1).attr('alt')).toBe('b')
    expect(imgs.eq(1).attr('loading')).toBe('eager')
    expect(imgs.eq(1).attr('decoding')).toBe('async')

    expect(imgs.eq(2).attr('alt')).toBe('c')
    expect(imgs.eq(2).attr('loading')).toBe('eager')
    expect(imgs.eq(2).attr('decoding')).toBe('sync')

    // 缺失 alt 属性时自动兜底补上空字符串 alt=""，且即使 loading/decoding 已存在也会写回变更
    expect(imgs.eq(3).attr('alt')).toBe('')
    expect(html).toContain('<img src="/no-alt.jpg" loading="eager" decoding="async" alt="">')

    // 显式空 alt="" 保持原样
    expect(imgs.eq(4).attr('alt')).toBe('')
    expect(imgs.eq(4).attr('loading')).toBe('lazy')
    expect(imgs.eq(4).attr('decoding')).toBe('async')
  })

  it('超过 8000 字符的未标注语言代码块跳过 highlightAuto 并保留转义纯文本，显式语言仍正常高亮', async () => {
    const autoSpy = vi.spyOn(hljs, 'highlightAuto')
    const largeUnlabeled = `const a = "<tag>";\n`.repeat(600) // > 8_000 chars
    const largeLabeled = `const b = 1;\n`.repeat(800) // > 8_000 chars
    const escapedLargeUnlabeled = largeUnlabeled.replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const raw = [
      `<pre><code>${escapedLargeUnlabeled}</code></pre>`,
      `<pre><code class="language-ts">${largeLabeled}</code></pre>`,
    ].join('')

    const { html } = await renderContentHtml(raw, { copyLabel: 'Copy' })
    const $ = cheerio.load(html, null, false)
    const wrappers = $(`[${CODE_BLOCK_ATTR}]`)

    expect(autoSpy).not.toHaveBeenCalled()
    expect(wrappers).toHaveLength(2)

    const unlabeledCode = wrappers.eq(0).find('pre > code')
    expect(unlabeledCode.hasClass('hljs')).toBe(false)
    expect(unlabeledCode.attr('data-highlighted')).toBeUndefined()
    expect(unlabeledCode.text()).toBe(largeUnlabeled)
    expect(unlabeledCode.html()).not.toContain('<tag>')

    const labeledCode = wrappers.eq(1).find('pre > code')
    expect(labeledCode.hasClass('hljs')).toBe(true)
    expect(labeledCode.attr('data-highlighted')).toBe('yes')
    expect(labeledCode.find('span').length).toBeGreaterThan(0)

    autoSpy.mockRestore()
  })
})
