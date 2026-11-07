/**
 * 正文行内图标：正文只保存 <span data-icon="图标名"></span>，不保存 SVG
 * - 图标名为 lucide 的 kebab-case 名（含别名）；以后接入其他图标库时用「前缀:名字」区分，现有内容无需迁移
 * - 大小（1em）与颜色（currentColor）跟随所在文字，加粗、颜色、高亮等标记包在外层同样生效（样式见 inline-icon.scss）
 * - 前台在服务端净化之后按名字填入 SVG（icon.ts 的 renderInlineIconsHtml），编辑器与本地预览在浏览器里按需加载单个图标
 * - 未知图标名：前台不显示，编辑器显示占位图标
 * 本文件不依赖图标数据，前台的客户端组件可以直接引用
 */
export const INLINE_ICON_ATTR = 'data-icon'
export const INLINE_ICON_SELECTOR = `span[${INLINE_ICON_ATTR}]`

const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 写法合法的图标名（不检查是否存在） */
export function isIconName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 64 && ICON_NAME_PATTERN.test(name)
}
