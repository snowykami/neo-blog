/**
 * 媒体框（图片 / 视频）宽度预设：占正文宽度的百分比，存为 data-width。
 * 三分之一、一半、四分之三、满宽与组件的宽度预设一致（见 content-components/layout.ts），另加黄金比例 61.8%；
 * 窄屏（640px 以下）一律满宽，样式见 image-figure.scss、video-figure.scss 与 image-node-view.scss
 */
export const MEDIA_WIDTH_PRESETS = ['33', '50', '61.8', '75', '100'] as const

export type MediaWidthPreset = (typeof MEDIA_WIDTH_PRESETS)[number]

/** 预设对应的 CSS 宽度（33 为三分之一） */
export const MEDIA_WIDTH_PERCENT: Record<MediaWidthPreset, string> = {
  33: '33.333%',
  50: '50%',
  61.8: '61.8%',
  75: '75%',
  100: '100%',
}

/** 读取 data-width：不是预设值时为 null（按像素宽度或原始尺寸显示） */
export function parseMediaWidthPreset(value: unknown): MediaWidthPreset | null {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && (MEDIA_WIDTH_PRESETS as readonly string[]).includes(text) ? text as MediaWidthPreset : null
}

/** 选择预设时写入的属性；null 为恢复原始尺寸 */
export function mediaWidthAttrs(preset: MediaWidthPreset | null) {
  return { 'data-width': preset }
}
