import type { ThemeDefinition } from '../types'

/**
 * 公历节日与现代节日主题。
 * 与 chinese.ts 一样只提供颜色原料，由 globals.css 统一派生 token。
 */
export const INTERNATIONAL_THEMES: ThemeDefinition[] = [
  // 12/20 ~ 12/26：松绿 + 雪白，飘雪装饰
  {
    id: 'christmas',
    priority: 70,
    schedule: { solar: [[12, 20], [12, 26]] },
    tokens: {
      hue: 155,
      chroma: 0.12,
      primaryL: 0.5,
      primaryLDark: 0.72,
      overlay: 'radial-gradient(64% 44% at 50% -10%, oklch(0.86 0.09 150 / 0.22), transparent 72%), radial-gradient(46% 34% at 100% 102%, oklch(0.7 0.19 25 / 0.14), transparent 74%)',
      overlayDark: 'radial-gradient(64% 44% at 50% -10%, oklch(0.55 0.11 150 / 0.3), transparent 72%), radial-gradient(46% 34% at 100% 102%, oklch(0.55 0.19 25 / 0.22), transparent 74%)',
    },
    effect: 'snow',
    mode: 'dark',
    icons: { like: 'snowflake', comment: 'bell', view: 'tree', pin: 'gift', share: 'gift' },
    decorLeft: [
      { glyph: 'tree', size: 124, x: 46, y: 18 },
      { glyph: 'gift', size: 68, x: 40, y: 62, rotate: -8 },
      { glyph: 'candy-corn', size: 44, x: 56, y: 84, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'snowman', size: 96, x: 48, y: 22 },
      { glyph: 'tree', size: 88, x: 50, y: 70, opacity: 0.95, flip: true },
    ],
    builtin: true,
  },
  // 12/30 ~ 1/2：跨年，深蓝紫夜空 + 金色烟花
  {
    id: 'new-year',
    priority: 75,
    schedule: { solar: [[12, 30], [1, 2]] },
    tokens: {
      hue: 245,
      chroma: 0.16,
      primaryL: 0.55,
      primaryLDark: 0.76,
      overlay: 'radial-gradient(56% 40% at 22% -8%, oklch(0.66 0.16 265 / 0.24), transparent 72%), radial-gradient(52% 38% at 82% -4%, oklch(0.8 0.14 85 / 0.16), transparent 72%)',
      overlayDark: 'radial-gradient(56% 40% at 22% -8%, oklch(0.5 0.16 265 / 0.36), transparent 72%), radial-gradient(52% 38% at 82% -4%, oklch(0.7 0.15 85 / 0.2), transparent 72%)',
      primaryImage: 'linear-gradient(160deg, oklch(0.9 0.1 90 / 0.3), transparent 58%)',
    },
    effect: 'fireworks',
    mode: 'dark',
    icons: { like: 'sparkles', comment: 'firework', view: 'star', pin: 'star', share: 'firework' },
    decorLeft: [
      { glyph: 'firework', size: 112, x: 47, y: 18 },
      { glyph: 'firework', size: 66, x: 40, y: 60, rotate: 12, opacity: 0.85 },
    ],
    decorRight: [
      { glyph: 'firework', size: 92, x: 50, y: 36, rotate: -8 },
    ],
    builtin: true,
  },
  // 10/28 ~ 11/1：南瓜橙 + 幽灵紫，暗色下压暗画面
  {
    id: 'halloween',
    priority: 60,
    schedule: { solar: [[10, 28], [11, 1]] },
    tokens: {
      hue: 45,
      chroma: 0.16,
      primaryL: 0.5,
      primaryLDark: 0.78,
      overlay: 'radial-gradient(60% 42% at 78% -8%, oklch(0.72 0.18 50 / 0.24), transparent 72%), radial-gradient(70% 50% at 8% 104%, oklch(0.45 0.14 300 / 0.18), transparent 74%)',
      overlayDark: 'radial-gradient(60% 42% at 78% -8%, oklch(0.5 0.18 50 / 0.34), transparent 72%), radial-gradient(70% 50% at 8% 104%, oklch(0.32 0.14 300 / 0.34), transparent 74%)',
    },
    effect: 'flicker',
    mode: 'dark',
    icons: { like: 'pumpkin', comment: 'ghost', view: 'bat', pin: 'candy', share: 'ghost' },
    decorLeft: [
      { glyph: 'spider-web', size: 104, x: 22, y: 6, opacity: 0.55 },
      { glyph: 'pumpkin', size: 112, x: 50, y: 22 },
      { glyph: 'bat', size: 84, x: 44, y: 55, rotate: -12 },
      { glyph: 'candy-corn', size: 52, x: 40, y: 80, rotate: 8 },
    ],
    decorRight: [
      { glyph: 'ghost', size: 96, x: 50, y: 26, rotate: 4 },
      { glyph: 'pumpkin', size: 78, x: 46, y: 66, rotate: 6, opacity: 0.95 },
      { glyph: 'bat', size: 56, x: 56, y: 88, rotate: 14, opacity: 0.8 },
    ],
    builtin: true,
  },
  // 2/10 ~ 2/15：粉红，与七夕（紫粉）错开色相
  {
    id: 'valentine',
    priority: 45,
    schedule: { solar: [[2, 10], [2, 15]] },
    tokens: {
      hue: 350,
      chroma: 0.15,
      primaryL: 0.56,
      primaryLDark: 0.75,
      overlay: 'radial-gradient(70% 48% at 50% -10%, oklch(0.78 0.15 350 / 0.22), transparent 72%)',
      overlayDark: 'radial-gradient(70% 48% at 50% -10%, oklch(0.58 0.16 350 / 0.28), transparent 72%)',
    },
    effect: 'stars',
    mode: 'dark',
    icons: { like: 'heart', comment: 'heart', view: 'star', pin: 'heart', share: 'heart' },
    decorLeft: [
      { glyph: 'heart', size: 96, x: 47, y: 22, rotate: -8 },
      { glyph: 'heart', size: 52, x: 38, y: 62, rotate: 10, opacity: 0.8 },
    ],
    decorRight: [
      { glyph: 'heart', size: 70, x: 50, y: 40, rotate: 6 },
    ],
    builtin: true,
  },
  // 5/31 ~ 6/2：糖果色，彩度略高
  {
    id: 'childrens-day',
    priority: 45,
    schedule: { solar: [[5, 31], [6, 2]] },
    tokens: {
      hue: 200,
      chroma: 0.15,
      primaryL: 0.55,
      primaryLDark: 0.76,
      overlay: 'radial-gradient(56% 40% at 16% -8%, oklch(0.8 0.13 200 / 0.22), transparent 72%), radial-gradient(50% 36% at 86% -4%, oklch(0.82 0.14 95 / 0.18), transparent 72%)',
      overlayDark: 'radial-gradient(56% 40% at 16% -8%, oklch(0.55 0.14 200 / 0.32), transparent 72%), radial-gradient(50% 36% at 86% -4%, oklch(0.6 0.14 95 / 0.24), transparent 72%)',
    },
    effect: 'confetti',
    mode: 'light',
    icons: { like: 'balloon', comment: 'candy', view: 'balloon', pin: 'gift', share: 'sparkles' },
    decorLeft: [
      { glyph: 'balloon', size: 104, x: 48, y: 22, rotate: -4 },
      { glyph: 'candy-corn', size: 46, x: 38, y: 62, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'balloon', size: 76, x: 50, y: 46, rotate: 5, flip: true },
      { glyph: 'gift', size: 54, x: 46, y: 78, rotate: -8, opacity: 0.9 },
    ],
    builtin: true,
  },
  // 10/1 ~ 10/7：中国红 + 金；与春节靠彩度与装饰区分
  {
    id: 'national-day',
    priority: 55,
    schedule: { solar: [[10, 1], [10, 7]] },
    tokens: {
      hue: 20,
      chroma: 0.18,
      primaryL: 0.5,
      primaryLDark: 0.72,
      overlay: 'radial-gradient(70% 46% at 50% -10%, oklch(0.66 0.2 25 / 0.22), transparent 72%), radial-gradient(40% 30% at 100% 100%, oklch(0.86 0.14 90 / 0.16), transparent 74%)',
      overlayDark: 'radial-gradient(70% 46% at 50% -10%, oklch(0.5 0.2 25 / 0.34), transparent 72%), radial-gradient(40% 30% at 100% 100%, oklch(0.72 0.15 90 / 0.18), transparent 74%)',
      primaryImage: 'linear-gradient(160deg, oklch(0.94 0.12 90 / 0.32), transparent 58%)',
    },
    effect: 'fireworks',
    mode: 'light',
    icons: { like: 'star', comment: 'firework', view: 'star', pin: 'star', share: 'firework' },
    decorLeft: [
      { glyph: 'firework', size: 104, x: 47, y: 22, rotate: -6 },
      { glyph: 'firework', size: 58, x: 40, y: 64, rotate: 10, opacity: 0.85 },
    ],
    decorRight: [
      { glyph: 'firework', size: 84, x: 50, y: 42, rotate: 8 },
    ],
    builtin: true,
  },
  // 9/10：暖黄，柔和不抢眼
  {
    id: 'teachers-day',
    priority: 40,
    schedule: { solar: [[9, 10], [9, 10]] },
    tokens: {
      hue: 40,
      chroma: 0.13,
      primaryL: 0.54,
      primaryLDark: 0.78,
      overlay: 'radial-gradient(64% 44% at 50% -10%, oklch(0.86 0.13 72 / 0.18), transparent 72%)',
      overlayDark: 'radial-gradient(64% 44% at 50% -10%, oklch(0.6 0.13 72 / 0.26), transparent 72%)',
    },
    mode: 'light',
    icons: { like: 'flower', comment: 'flower', view: 'leaf', pin: 'star', share: 'sparkles' },
    decorLeft: [
      { glyph: 'daisy', size: 88, x: 47, y: 28, rotate: -6 },
      { glyph: 'daisy', size: 52, x: 40, y: 68, rotate: 12, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'daisy', size: 72, x: 50, y: 48, rotate: 6 },
    ],
    builtin: true,
  },
  // 11/10 ~ 11/12：橙红，商业活动色
  {
    id: 'double-eleven',
    priority: 45,
    schedule: { solar: [[11, 10], [11, 12]] },
    tokens: {
      hue: 10,
      chroma: 0.18,
      primaryL: 0.52,
      primaryLDark: 0.74,
      overlay: 'radial-gradient(60% 42% at 50% -10%, oklch(0.68 0.19 30 / 0.22), transparent 72%)',
      overlayDark: 'radial-gradient(60% 42% at 50% -10%, oklch(0.52 0.19 30 / 0.32), transparent 72%)',
    },
    mode: 'light',
    icons: { like: 'gift', comment: 'gift', view: 'star', pin: 'gift', share: 'sparkles' },
    decorLeft: [
      { glyph: 'gift', size: 100, x: 47, y: 24, rotate: -8 },
      { glyph: 'gift', size: 58, x: 40, y: 66, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'gift', size: 76, x: 50, y: 46, rotate: 6 },
    ],
    builtin: true,
  },
  // 10/24：终端绿，恰好与万圣节（10/28 起）不重叠
  {
    id: 'programmers-day',
    priority: 50,
    schedule: { solar: [[10, 24], [10, 24]] },
    tokens: {
      hue: 150,
      chroma: 0.14,
      primaryL: 0.5,
      primaryLDark: 0.72,
      overlay: 'radial-gradient(70% 46% at 50% -10%, oklch(0.72 0.14 155 / 0.18), transparent 72%)',
      overlayDark: 'radial-gradient(70% 46% at 50% -10%, oklch(0.52 0.14 155 / 0.28), transparent 72%)',
    },
    mode: 'dark',
    icons: { like: 'terminal', comment: 'terminal', view: 'star', pin: 'terminal', share: 'sparkles' },
    builtin: true,
  },
]
