import type { LyricAgent, LyricColor, LyricMood } from './types'

/**
 * 歌词标注的语义化色板（强调短语上色、播放器页背景染色共用；名称与后端 lyricAnnotationPalette 一致）：
 * 色值偏亮、饱和度适中，深色界面上清晰；用于文字时与文字原色混合，浅色界面上也不刺眼
 */
export const LYRIC_COLORS: Record<LyricColor, string> = {
  // 红 / 橙
  'crimson': '#ff5c6c', // 绯红
  'rose': '#ff6f91', // 玫瑰红
  'flame': '#ff6a3d', // 火焰红
  'sunset': '#ff8a65', // 晚霞红
  'coral': '#ff9f80', // 珊瑚橙
  'maple': '#ff7f3f', // 枫叶橙
  'amber': '#ffb347', // 琥珀橙
  // 粉
  'peach': '#ffa8a0', // 蜜桃粉
  'cherry-blossom': '#ffb3c8', // 樱花粉
  'bauhinia': '#e86fb0', // 紫荆红
  // 黄
  'sunshine': '#ffd54f', // 阳光金
  'gold': '#f5c542', // 鎏金
  'lemon': '#fff176', // 柠檬黄
  'candlelight': '#ffe0a3', // 烛光暖黄
  // 绿
  'spring-green': '#a5e887', // 嫩芽绿
  'forest': '#5fd38d', // 森林绿
  'mint': '#8ef0c8', // 薄荷绿
  'jade': '#3fcf9e', // 翡翠绿
  'aurora': '#6effd0', // 极光绿
  // 青 / 蓝
  'lake': '#4fd1d9', // 湖水青
  'sky': '#74c0fc', // 天空蓝
  'ocean': '#3d9df5', // 海洋蓝
  'starry-blue': '#6c8cff', // 星空蓝
  'midnight': '#7b83eb', // 午夜蓝
  'ice': '#b5e8ff', // 冰蓝
  'rain': '#9bb7d4', // 雨幕蓝灰
  // 紫
  'lavender': '#c3a6ff', // 薰衣草紫
  'violet': '#a77bff', // 罗兰紫
  'twilight': '#b388eb', // 暮光紫
  'wisteria': '#d4a5f5', // 紫藤
  // 白
  'moonlight': '#f0f4ff', // 月光白
  'silver': '#d7dde8', // 银白
}

/** 颜色的 RGB 分量（0 ~ 255），供 canvas 拼接带透明度的颜色 */
export type Rgb = [number, number, number]

/** #rrggbb → RGB 分量 */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const HEX_COLOR_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** 解析 #rgb / #rgba / #rrggbb / #rrggbbaa，统一归一化为小写 #rrggbb（忽略 alpha）；非法值返回 undefined */
export function parseHexColor(raw?: string | null): string | undefined {
  if (!raw)
    return undefined
  const match = HEX_COLOR_RE.exec(raw.trim())
  if (!match)
    return undefined
  const hex = match[1].toLowerCase()
  if (hex.length <= 4)
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  return `#${hex.slice(0, 6)}`
}

/** 按 RGB 欧氏距离将任意 #rrggbb 映射到 32 色语义色板中最近的颜色（供舞台洗光等读取 LYRIC_COLORS 使用） */
export function nearestLyricColor(hex: string): LyricColor {
  const normalized = parseHexColor(hex)
  if (!normalized)
    return 'sky'
  const [r, g, b] = hexToRgb(normalized)
  let bestColor: LyricColor = 'sky'
  let bestDist = Number.POSITIVE_INFINITY
  for (const [name, paletteHex] of Object.entries(LYRIC_COLORS) as [LyricColor, string][]) {
    const [pr, pg, pb] = hexToRgb(paletteHex)
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (dist < bestDist) {
      bestDist = dist
      bestColor = name
    }
  }
  return bestColor
}

/** 解析演唱者实际渲染用十六进制色（TTML 原生 colorHex 优先，否则取语义色板映射色） */
export function resolveAgentHex(agent: Pick<LyricAgent, 'color' | 'colorHex'>): string {
  return agent.colorHex ?? LYRIC_COLORS[agent.color]
}

// 情绪基调对应的辉光颜色（偏淡，叠在白色文字上只带一点色温；后台编辑器用作情绪标记的颜色）
export const MOOD_GLOW: Record<LyricMood, string> = {
  calm: '#cfe8ff',
  bright: '#ffe6a8',
  sad: '#d6ceff',
  intense: '#ffc0b3',
}
