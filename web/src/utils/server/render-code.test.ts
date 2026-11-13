// @vitest-environment node
import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { CODE_BLOCK_ATTR, CODE_COPY_ATTR } from '@/utils/common/code-block'
import { renderCodeBlocks } from './render-code'

describe('renderCodeBlocks 代码块服务端预渲染', () => {
  it('包装常见语言代码块、注入语言名与复制按钮，并完成 highlight.js 着色', () => {
    const input = '<p>正文</p><pre><code class="language-ts">const x = 1</code></pre>'
    const html = renderCodeBlocks(input, '复制')
    const $ = cheerio.load(html, null, false)

    const wrapper = $(`[${CODE_BLOCK_ATTR}]`)
    expect(wrapper).toHaveLength(1)
    expect(wrapper.find(`[${CODE_COPY_ATTR}]`).text()).toBe('复制')
    expect(wrapper.text()).toContain('TypeScript')

    const code = wrapper.find('pre > code')
    expect(code.hasClass('hljs')).toBe(true)
    expect(code.attr('data-highlighted')).toBe('yes')
    expect(code.find('span').length).toBeGreaterThan(0)
  })

  it('plaintext 与未注册语言仍包装工具栏以消除布局偏移，但不写入 data-highlighted', () => {
    const input = [
      '<pre><code class="language-plaintext">plain line</code></pre>',
      '<pre><code class="language-unknownlang">foo bar</code></pre>',
    ].join('')
    const html = renderCodeBlocks(input, 'Copy')
    const $ = cheerio.load(html, null, false)

    const wrappers = $(`[${CODE_BLOCK_ATTR}]`)
    expect(wrappers).toHaveLength(2)
    expect(wrappers.eq(0).text()).toContain('plaintext')
    expect(wrappers.eq(1).text()).toContain('unknownlang')
    expect($('code[data-highlighted="yes"]')).toHaveLength(0)
    expect($(`[${CODE_COPY_ATTR}]`).eq(0).text()).toBe('Copy')
  })

  it('跳过组件岛内的代码块，且对已包装代码块保持幂等', () => {
    const insideComponent = '<div data-component-root=""><pre><code class="language-ts">const a = 1</code></pre></div>'
    expect(renderCodeBlocks(insideComponent, '复制')).toBe(insideComponent)

    const first = renderCodeBlocks('<pre><code class="language-ts">const b = 2</code></pre>', '复制')
    const second = renderCodeBlocks(first, '复制')
    expect(second).toBe(first)
    const $ = cheerio.load(second, null, false)
    expect($(`[${CODE_BLOCK_ATTR}]`)).toHaveLength(1)
  })
})
