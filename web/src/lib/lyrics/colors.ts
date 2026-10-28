import type { LyricColor } from './types'

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
