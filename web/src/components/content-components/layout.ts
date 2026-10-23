/**
 * 组件块布局：宽度与高度只能取预设值（保证全站组件尺寸统一）；对齐方式与图片一致（块级，不做文字环绕）
 * 存储为占位元素上的 data-width / data-align / data-height，取默认值（满宽、居中、自动高度）时不输出；样式见 component-layout.css
 */

export const COMPONENT_WIDTHS = [33, 50, 75, 100] as const
export type ComponentWidth = typeof COMPONENT_WIDTHS[number]

export const COMPONENT_ALIGNS = ['left', 'center', 'right'] as const
export type ComponentAlign = typeof COMPONENT_ALIGNS[number]

/**
 * 高度单位：1 单位 = 6rem（96px），相邻组件间距 1rem；n 单位高度 = n × 6rem + (n - 1) × 1rem（96 / 208 / 320 / 432px），
 * 两个 1 单位的组件加上间距正好等于一个 2 单位的组件。未设置时高度随内容自适应
 */
export const COMPONENT_HEIGHTS = [1, 2, 3, 4] as const
export type ComponentHeight = typeof COMPONENT_HEIGHTS[number]

const HEIGHT_UNIT_REM = 6
const HEIGHT_GAP_REM = 1

/** n 单位对应的高度（rem） */
export function componentHeightRem(height: ComponentHeight): number {
  return height * HEIGHT_UNIT_REM + (height - 1) * HEIGHT_GAP_REM
}

/** 读取 data-width：非预设值按满宽处理（返回 null） */
export function parseComponentWidth(raw: unknown): ComponentWidth | null {
  const value = Number(raw)
  return COMPONENT_WIDTHS.includes(value as ComponentWidth) && value !== 100 ? value as ComponentWidth : null
}

/** 读取 data-align：非法值按居中处理（返回 null） */
export function parseComponentAlign(raw: unknown): ComponentAlign | null {
  return COMPONENT_ALIGNS.includes(raw as ComponentAlign) && raw !== 'center' ? raw as ComponentAlign : null
}

/** 读取 data-height：传入 supported 时只接受组件支持的档位；其余按自动高度处理（返回 null） */
export function parseComponentHeight(raw: unknown, supported: readonly ComponentHeight[] = COMPONENT_HEIGHTS): ComponentHeight | null {
  if (raw == null || raw === '')
    return null
  const value = Number(raw)
  return supported.includes(value as ComponentHeight) ? value as ComponentHeight : null
}

/** 占位元素 / 节点视图上的布局属性：满宽时对齐无意义，不输出；高度应先按组件支持的档位过滤 */
export function componentLayoutAttrs(width: unknown, align: unknown, height?: unknown): Record<string, string> {
  const attrs: Record<string, string> = {}
  const w = parseComponentWidth(width)
  if (w != null) {
    attrs['data-width'] = String(w)
    const a = parseComponentAlign(align)
    if (a)
      attrs['data-align'] = a
  }
  const h = parseComponentHeight(height)
  if (h != null)
    attrs['data-height'] = String(h)
  return attrs
}
