/**
 * 图片宽度预设：占正文宽度的百分比，存为 data-width（与像素宽度 width 互斥：选预设时清除像素宽度，拖动调整时清除预设）。
 * 三分之一、一半、四分之三、满宽与组件的宽度预设一致（见 content-components/layout.ts），另加黄金比例 61.8%；
 * 窄屏（640px 以下）一律满宽，样式见 image-figure.scss 与 image-node-view.scss
 */
export const IMAGE_WIDTH_PRESETS = ['33', '50', '61.8', '75', '100'] as const

export type ImageWidthPreset = (typeof IMAGE_WIDTH_PRESETS)[number]

/** 预设对应的 CSS 宽度（33 为三分之一） */
export const IMAGE_WIDTH_PERCENT: Record<ImageWidthPreset, string> = {
  33: '33.333%',
  50: '50%',
  61.8: '61.8%',
  75: '75%',
  100: '100%',
}

/** 读取 data-width：不是预设值时为 null（按像素宽度或原始尺寸显示） */
export function parseImageWidthPreset(value: unknown): ImageWidthPreset | null {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && (IMAGE_WIDTH_PRESETS as readonly string[]).includes(text) ? text as ImageWidthPreset : null
}

/** 选择预设时写入的属性：清除像素宽高，避免与百分比宽度冲突或被拉伸；null 为恢复原始尺寸 */
export function imageWidthAttrs(preset: ImageWidthPreset | null) {
  return { 'data-width': preset, 'width': null, 'height': null }
}
