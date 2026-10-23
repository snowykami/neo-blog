/**
 * 组件块布局：宽度只能取预设百分比（保证全站组件尺寸统一），高度随内容自适应；对齐方式与图片一致（块级，不做文字环绕）
 * 存储为占位元素上的 data-width / data-align，满宽（默认）时不输出；样式见 component-layout.css
 */

export const COMPONENT_WIDTHS = [33, 50, 75, 100] as const
export type ComponentWidth = typeof COMPONENT_WIDTHS[number]

export const COMPONENT_ALIGNS = ['left', 'center', 'right'] as const
export type ComponentAlign = typeof COMPONENT_ALIGNS[number]

/** 读取 data-width：非预设值按满宽处理（返回 null） */
export function parseComponentWidth(raw: unknown): ComponentWidth | null {
  const value = Number(raw)
  return COMPONENT_WIDTHS.includes(value as ComponentWidth) && value !== 100 ? value as ComponentWidth : null
}

/** 读取 data-align：非法值按居中处理（返回 null） */
export function parseComponentAlign(raw: unknown): ComponentAlign | null {
  return COMPONENT_ALIGNS.includes(raw as ComponentAlign) && raw !== 'center' ? raw as ComponentAlign : null
}

/** 占位元素 / 节点视图上的布局属性；满宽时对齐无意义，不输出 */
export function componentLayoutAttrs(width: unknown, align: unknown): Record<string, string> {
  const w = parseComponentWidth(width)
  if (w == null)
    return {}
  const a = parseComponentAlign(align)
  return a ? { 'data-width': String(w), 'data-align': a } : { 'data-width': String(w) }
}
