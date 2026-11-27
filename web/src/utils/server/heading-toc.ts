import type { TocHeading } from '@/models/toc'
import * as cheerio from 'cheerio'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { MATH_SELECTOR } from '@/lib/math/latex'

// 生成目录的标题层级
const TOC_SELECTOR = 'h1, h2, h3, h4'
// 代码块与内嵌组件岛内部的子节点不参与正文目录锚点提取
const SKIP_ANCESTOR_SELECTOR = `pre, code, ${COMPONENT_ROOT_SELECTOR}`
// 生成的锚点统一加前缀，避免与页面中已有元素 id 冲突（DOM clobbering）
const ID_PREFIX = 'heading-'

// 标题文字转锚点：保留各语言文字与数字，空白转为连字符
function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * 在已加载的 Cheerio AST 上提取标题目录并注入唯一锚点 id，供独立调用与单遍正文管线共用
 */
export function extractHeadingsFromRoot($: cheerio.CheerioAPI): { headings: TocHeading[], mutated: boolean } {
  const headingEls = $(TOC_SELECTOR)
  if (headingEls.length === 0)
    return { headings: [], mutated: false }

  const used = new Set<string>()
  const headings: TocHeading[] = []
  let mutated = false

  headingEls.each((index, el) => {
    const $el = $(el)
    if ($el.closest(SKIP_ANCESTOR_SELECTOR).length > 0)
      return
    // 标题中的公式（此时尚未渲染）按 LaTeX 源码计入目录文字
    const $text = $el.clone()
    $text.find(MATH_SELECTOR).each((_, math) => {
      $(math).text($(math).attr('data-latex') ?? '')
    })
    const text = $text.text().trim()
    if (!text)
      return
    const base = `${ID_PREFIX}${slugify(text) || index + 1}`
    let id = base
    for (let n = 2; used.has(id); n++)
      id = `${base}-${n}`
    used.add(id)
    $el.attr('id', id)
    headings.push({ id, text, level: Number(el.tagName.slice(1)) })
    mutated = true
  })

  return { headings, mutated }
}

/**
 * 为正文中的 h1–h4 注入稳定且唯一的 id，并提取目录
 * - 需在净化之后调用：生成的 id 来自标题文字，不引入任何外部属性
 * - 同名标题依次追加 -2、-3 … 保证唯一
 */
export function extractHeadings(html: string): { html: string, headings: TocHeading[] } {
  if (!html || !/<h[1-4]\b/i.test(html))
    return { html, headings: [] }
  const $ = cheerio.load(html, null, false)
  const { headings, mutated } = extractHeadingsFromRoot($)
  return { html: mutated ? $.html() : html, headings }
}
