import type { IconNode, LucideIconNode } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { INLINE_ICON_ATTR, isIconName } from './constants'

export * from './constants'

// 行内图标的数据与渲染（存储格式见 constants.ts）：图标数据来自已安装的 lucide-react，每个图标单独按需加载

type IconImportName = keyof typeof dynamicIconImports

/** 已安装的 lucide 中存在的图标（含别名） */
export function hasIcon(name: string): name is IconImportName {
  return isIconName(name) && Object.hasOwn(dynamicIconImports, name)
}

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderNode([tag, attrs, children]: LucideIconNode): string {
  if (!/^[a-z]+$/i.test(tag))
    return ''
  const attributes = Object.entries(attrs)
    .filter(([key, value]) => key !== 'key' && /^[a-z][\w-]*$/i.test(key) && value != null)
    .map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
    .join('')
  const inner = children?.map(child => renderNode(child)).join('') ?? ''
  return `<${tag}${attributes}>${inner}</${tag}>`
}

/**
 * 图标的 SVG 标记：服务端渲染、编辑器与本地预览共用，保证各处一致
 * width / height 写成 1em：订阅源阅读器等没有站点样式的地方也和文字一样大
 */
export function iconSvgMarkup(node: IconNode): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + `${node.map(child => renderNode(child)).join('')}</svg>`
}

// 图标数据不可变：同一进程内按名字缓存加载结果
const svgCache = new Map<string, Promise<string | null>>()

/** 按名字加载图标的 SVG 标记；未知的图标名返回 null */
export function loadIconSvg(name: string): Promise<string | null> {
  if (!hasIcon(name))
    return Promise.resolve(null)
  let svg = svgCache.get(name)
  if (!svg) {
    svg = dynamicIconImports[name]()
      .then(mod => iconSvgMarkup(mod.__iconData.node))
      .catch(() => {
        // 网络等原因加载失败时允许重试
        svgCache.delete(name)
        return null
      })
    svgCache.set(name, svg)
  }
  return svg
}

// 净化后的正文中空的图标标记（DOMPurify 输出的属性一律为双引号）
const EMPTY_SPAN = /<span\b([^>]*)><\/span>/g
const ICON_ATTR_VALUE = new RegExp(`\\s${INLINE_ICON_ATTR}="([^"]*)"`)

/**
 * 在净化后的正文 HTML 中填入图标的 SVG（只加载用到的图标）
 * 只处理空的 <span data-icon>：带文字的同名标记不是编辑器产出的图标，原样保留；未知图标名保持为空
 */
export async function renderInlineIconsHtml(html: string): Promise<string> {
  if (!html.includes(INLINE_ICON_ATTR))
    return html
  const names = new Set<string>()
  for (const [, attrs] of html.matchAll(EMPTY_SPAN)) {
    const name = ICON_ATTR_VALUE.exec(attrs)?.[1]
    if (name && hasIcon(name))
      names.add(name)
  }
  if (names.size === 0)
    return html
  const svgs = new Map(await Promise.all([...names].map(async name => [name, await loadIconSvg(name)] as const)))
  return html.replace(EMPTY_SPAN, (match, attrs: string) => {
    const name = ICON_ATTR_VALUE.exec(attrs)?.[1]
    const svg = name ? svgs.get(name) : null
    return svg ? `<span${attrs}>${svg}</span>` : match
  })
}
