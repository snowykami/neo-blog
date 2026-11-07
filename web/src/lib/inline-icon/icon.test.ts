import type { LucideMeta } from './catalog'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { icons } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { describe, expect, it } from 'vitest'
import { iconComponentName } from './catalog'
import { hasIcon, iconSvgMarkup, isIconName, loadIconSvg, renderInlineIconsHtml } from './icon'
import metaJSON from './lucide-meta.json'

const LOCALES = ['zh', 'zh-tw', 'en', 'ja', 'ko']
const meta = metaJSON as LucideMeta

describe('图标名', () => {
  it('只接受 kebab-case', () => {
    expect(isIconName('circle-check')).toBe(true)
    expect(isIconName('arrow-down-0-1')).toBe(true)
    for (const name of ['', 'Star', 'star ', 'a--b', '-a', 'a_b', '<x>', 'si:github', 'x'.repeat(65)])
      expect(isIconName(name)).toBe(false)
    expect(isIconName(null)).toBe(false)
  })

  it('别名也是存在的图标，未知图标名不存在', () => {
    expect(hasIcon('star')).toBe(true)
    // lucide 改名后保留的别名
    expect(hasIcon('alarm-check')).toBe(true)
    expect(hasIcon('not-an-icon')).toBe(false)
    expect(hasIcon('__proto__')).toBe(false)
  })

  // 后端 MCP 读取这份清单校验 AI 写入的图标名；升级 lucide-react 后运行 pnpm test -u 更新
  it('keeps the backend icon name list in sync', async () => {
    await expect(`${Object.keys(dynamicIconImports).sort().join('\n')}\n`).toMatchFileSnapshot('../../../../internal/mcpserver/lucide-icons.txt')
  })
})

describe('图标检索数据', () => {
  it('与已安装的 lucide-react 版本一致（升级后运行 node scripts/gen-lucide-icon-meta.mjs）', () => {
    const { version } = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/lucide-react/package.json'), 'utf8'))
    expect(meta.version).toBe(version)
  })

  it('每个图标都有对应的组件与图标数据', () => {
    const missing = meta.icons.filter(([name]) => !hasIcon(name) || !(iconComponentName(name) in icons))
    expect(missing).toEqual([])
    expect(meta.icons.length).toBe(Object.keys(icons).length)
  })

  it('每个分类在各语言中都有名称', () => {
    for (const locale of LOCALES) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), `src/locales/${locale}.json`), 'utf8'))
      const labels = messages.Console.editor.icon.categories as Record<string, string>
      expect(Object.keys(labels).sort(), locale).toEqual([...meta.categories].sort())
    }
  })
})

describe('sVG 渲染', () => {
  it('与 lucide 的属性一致，宽高跟随文字', async () => {
    const svg = await loadIconSvg('minus')
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"></path></svg>')
  })

  it('转义属性值，忽略非法的标签与属性名', () => {
    expect(iconSvgMarkup([['path', { 'd': 'M0 0"/><script>', 'onload': 'x', 'on load': 'y' } as never], ['scr ipt', {}]]))
      .toContain('<path d="M0 0&quot;/&gt;&lt;script&gt;" onload="x"></path></svg>')
  })

  it('未知图标名返回 null', async () => {
    expect(await loadIconSvg('not-an-icon')).toBeNull()
  })
})

describe('正文中的图标', () => {
  it('填入用到的图标，保留其他属性与外层格式', async () => {
    const html = await renderInlineIconsHtml('<p><strong><span data-icon="minus"></span>减</strong> <span class="x" data-icon="minus"></span></p>')
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('<strong><span data-icon="minus"><svg')
    expect(html).toContain('<span class="x" data-icon="minus"><svg')
  })

  it('未知图标名与带文字的同名标记保持原样', async () => {
    const html = '<p><span data-icon="not-an-icon"></span><span data-icon="minus">文字</span><span data-annotation="x"></span></p>'
    expect(await renderInlineIconsHtml(html)).toBe(html)
  })
})
