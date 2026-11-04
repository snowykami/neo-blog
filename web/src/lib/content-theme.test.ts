import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rewriteFontCss, WEBFONTS } from '../../scripts/gen-webfonts.mjs'
import { ALL_WEBFONTS, CONTENT_THEMES, contentWebFonts, resolveContentTheme, usedContentFonts } from './content-theme'

describe('内容主题', () => {
  it('与后端 config.ContentThemes 一致', () => {
    const source = readFileSync(join(__dirname, '../../../internal/config/content_themes.go'), 'utf8')
    const list = source.match(/var ContentThemes = \[\]string\{([^}]*)\}/)?.[1] ?? ''
    expect([...list.matchAll(/"([^"]+)"/g)].map(m => m[1])).toEqual([...CONTENT_THEMES])
  })

  it('文章未选或选了不认识的主题时跟随站点默认', () => {
    expect(resolveContentTheme('book', 'github')).toBe('book')
    expect(resolveContentTheme('', 'github')).toBe('github')
    expect(resolveContentTheme('neon', 'github')).toBe('github')
    expect(resolveContentTheme(null, undefined)).toBe('default')
    expect(resolveContentTheme(undefined, 'neon')).toBe('default')
  })
})

describe('正文网页字体', () => {
  it('只加载主题与局部字体用到的网页字体', () => {
    const html = '<p><span data-font="kai">楷</span><span data-font="xingkai">行</span><span data-font="comic">x</span><span data-font="kai">又</span></p>'
    expect(usedContentFonts(html)).toEqual(['kai', 'xingkai'])
    expect(contentWebFonts('default', '<p>正文</p>')).toEqual([])
    expect(contentWebFonts('book', html)).toEqual(['noto-serif-sc', 'lxgw-wenkai', 'zhi-mang-xing'])
    // 系统字体不需要下载
    expect(contentWebFonts('github', '<p><span data-font="sans">a</span><span data-font="mono">b</span></p>')).toEqual([])
  })

  it('用到的网页字体都由 gen-webfonts 生成', () => {
    expect([...ALL_WEBFONTS].sort()).toEqual(Object.keys(WEBFONTS).sort())
  })

  it('改写字体包 CSS：只保留 woff2 并指向 public 下的副本', () => {
    const css = `/* x */
@font-face {
  font-family: 'Noto Serif SC';
  font-display: swap;
  src: url(./files/a-400.woff2) format('woff2'), url(./files/a-400.woff) format('woff');
  unicode-range: U+4e00-4e10;
}
@font-face {
  font-family: 'LXGW WenKai Screen';
  font-display: block;
  src: url('./files/b.woff2') format('woff2');
}`
    const result = rewriteFontCss(css, '/fonts/x/1.0.0')
    expect(result.files).toEqual(['a-400.woff2', 'b.woff2'])
    expect(result.css).toContain('src: url(/fonts/x/1.0.0/a-400.woff2) format(\'woff2\');')
    expect(result.css).toContain('unicode-range: U+4e00-4e10;')
    expect(result.css).not.toContain('.woff)')
    expect(result.css).not.toContain('font-display: block')
  })
})
