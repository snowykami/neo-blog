import type { PageBackground } from './siteinfo'
import { fallbackSiteInfo } from './siteinfo'

/**
 * 全站背景的配置解析（纯函数，便于单测）。
 *
 * 来自站点信息（后台可配）的值是「默认值」，页面级还可以通过 PageBackgroundProvider 的
 * config / setPageBackground 局部覆盖，这里的职责只是把外部数据收敛成一个可信的结构：
 * 越界的模糊度、不透明度、遮罩强度都会被夹到合法区间，避免一条脏配置把前台糊成一片。
 */
export interface ResolvedPageBackground {
  /** 是否启用背景（关掉时连装饰也一起不显示） */
  enabled: boolean
  /** 背景底色，缺省用主题的 --background */
  color?: string
  /** 背景图：地址与渲染参数；src 为空表示没有图片 */
  image?: {
    src: string
    blur: number
    opacity: number
    position: string
    size: string
  }
  /** 蒙版不透明度 0-1：图片越花，这里越高；没有图片时就是纯色背景的不透明度 */
  veil: number
  /** 蒙版颜色；未设置时由 CSS 回退到 var(--background)，从而跟随明暗与节日主题 */
  veilColor?: string
  /** 是否渲染节日装饰（两侧留白轨道） */
  decorations: boolean
}

const IMAGE_DEFAULTS = {
  blur: 0,
  opacity: 1,
  veil: 0.72,
  position: 'center',
  size: 'cover',
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value))
    return fallback
  return Math.min(max, Math.max(min, value))
}

/** 站点信息里的背景 → 可渲染结构；页面级 patch 在调用方合并后再走一次这里 */
export function resolvePageBackground(input?: PageBackground | null): ResolvedPageBackground {
  const raw = input ?? fallbackSiteInfo.pageBackground ?? {}
  const decorations = raw.decorations !== false
  const src = raw.image?.trim() ?? ''
  const veilColor = raw.veilColor?.trim()
  return {
    enabled: raw.enabled !== false,
    image: src
      ? {
          src,
          blur: clamp(raw.blur, 0, 40, IMAGE_DEFAULTS.blur),
          opacity: clamp(raw.opacity, 0, 1, IMAGE_DEFAULTS.opacity),
          position: IMAGE_DEFAULTS.position,
          size: IMAGE_DEFAULTS.size,
        }
      : undefined,
    veil: clamp(raw.veil, 0, 1, IMAGE_DEFAULTS.veil),
    veilColor: veilColor || undefined,
    decorations,
  }
}

/** 把若干层配置按顺序合并（后者覆盖前者），用于「站点默认 ← 页面覆盖」 */
export function mergePageBackground(
  ...layers: (PageBackground | null | undefined)[]
): ResolvedPageBackground {
  const merged: PageBackground = {}
  for (const layer of layers) {
    if (!layer)
      continue
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && value !== null)
        (merged as Record<string, unknown>)[key] = value
    }
  }
  return resolvePageBackground(merged)
}
