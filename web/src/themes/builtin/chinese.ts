import type { ThemeDefinition } from '../types'

/**
 * 中国传统节日主题。
 * 只改色相 / 彩度 / 主色亮度与装饰渐变，具体 token 由 globals.css 从 --hue 派生，
 * 因此这些主题在明暗模式下都不会破坏对比度，也不会改变任何形状与尺寸。
 */
export const CHINESE_FESTIVAL_THEMES: ThemeDefinition[] = [
  // 除夕 ~ 正月初七：红金配色，界面顶部一层暖红光晕，暗色下偏深红
  {
    id: 'spring-festival',
    priority: 100,
    schedule: { lunar: [[12, 28], [1, 7]] },
    tokens: {
      hue: 25,
      chroma: 0.17,
      primaryL: 0.52,
      primaryLDark: 0.72,
      overlay: 'radial-gradient(62% 44% at 50% -10%, oklch(0.72 0.19 28 / 0.22), transparent 72%), radial-gradient(44% 34% at 100% 102%, oklch(0.85 0.14 85 / 0.16), transparent 74%)',
      overlayDark: 'radial-gradient(62% 44% at 50% -10%, oklch(0.55 0.19 25 / 0.32), transparent 72%), radial-gradient(44% 34% at 100% 102%, oklch(0.7 0.15 80 / 0.16), transparent 74%)',
      primaryImage: 'linear-gradient(160deg, oklch(0.92 0.12 85 / 0.35), transparent 58%)',
    },
    effect: 'lantern',
    mode: 'dark',
    icons: { like: 'lantern', comment: 'dumpling', view: 'plum-blossom', pin: 'firework', share: 'sparkles' },
    decorLeft: [
      { glyph: 'lantern', size: 92, x: 48, y: 14, rotate: -7 },
      { glyph: 'firecracker', size: 60, x: 26, y: 47, rotate: 9 },
      { glyph: 'plum', size: 132, x: 44, y: 76 },
    ],
    decorRight: [
      { glyph: 'lantern', size: 74, x: 46, y: 30, rotate: 7 },
      { glyph: 'plum', size: 120, x: 42, y: 72, opacity: 0.95 },
    ],
    builtin: true,
  },
  // 正月十四 ~ 十六：琥珀金，与春节同色系但更亮，避免与春节区间（至正月初七）重叠
  {
    id: 'lantern-festival',
    priority: 95,
    schedule: { lunar: [[1, 14], [1, 16]] },
    tokens: {
      hue: 40,
      chroma: 0.15,
      primaryL: 0.54,
      primaryLDark: 0.78,
      overlay: 'radial-gradient(70% 50% at 50% -12%, oklch(0.86 0.15 78 / 0.24), transparent 74%)',
      overlayDark: 'radial-gradient(70% 50% at 50% -12%, oklch(0.62 0.15 72 / 0.3), transparent 74%)',
    },
    effect: 'lantern',
    mode: 'dark',
    icons: { like: 'lantern', comment: 'dumpling', view: 'plum-blossom', pin: 'lantern', share: 'sparkles' },
    decorLeft: [
      { glyph: 'lantern', size: 88, x: 46, y: 18, rotate: -6 },
      { glyph: 'lantern', size: 60, x: 54, y: 62, rotate: 8, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'lantern', size: 78, x: 48, y: 36, rotate: 6 },
    ],
    builtin: true,
  },
  // 五月初四 ~ 初六：艾草绿，带一点龙舟的水色
  {
    id: 'dragon-boat',
    priority: 60,
    schedule: { lunar: [[5, 4], [5, 6]] },
    tokens: {
      hue: 145,
      chroma: 0.13,
      primaryL: 0.5,
      primaryLDark: 0.72,
      overlay: 'radial-gradient(58% 40% at 50% -8%, oklch(0.74 0.13 150 / 0.2), transparent 72%), radial-gradient(40% 30% at 0% 100%, oklch(0.78 0.09 210 / 0.14), transparent 72%)',
      overlayDark: 'radial-gradient(58% 40% at 50% -8%, oklch(0.55 0.13 150 / 0.28), transparent 72%), radial-gradient(40% 30% at 0% 100%, oklch(0.6 0.1 210 / 0.18), transparent 72%)',
    },
    mode: 'light',
    icons: { like: 'zongzi', comment: 'leaf', view: 'cloud-rain', pin: 'zongzi', share: 'sparkles' },
    decorLeft: [
      { glyph: 'zongzi', size: 78, x: 48, y: 26, rotate: -6 },
      { glyph: 'zongzi', size: 56, x: 38, y: 66, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'zongzi', size: 68, x: 50, y: 44, rotate: 6 },
    ],
    builtin: true,
  },
  // 七月初六 ~ 初八：银河紫粉，细碎星点
  {
    id: 'qixi',
    priority: 60,
    schedule: { lunar: [[7, 6], [7, 8]] },
    tokens: {
      hue: 330,
      chroma: 0.14,
      primaryL: 0.55,
      primaryLDark: 0.76,
      overlay: 'radial-gradient(80% 55% at 12% -10%, oklch(0.72 0.14 330 / 0.2), transparent 72%), radial-gradient(70% 50% at 92% -6%, oklch(0.68 0.13 285 / 0.18), transparent 72%)',
      overlayDark: 'radial-gradient(80% 55% at 12% -10%, oklch(0.55 0.15 330 / 0.28), transparent 72%), radial-gradient(70% 50% at 92% -6%, oklch(0.52 0.14 285 / 0.26), transparent 72%)',
    },
    effect: 'stars',
    mode: 'dark',
    icons: { like: 'twin-stars', comment: 'magpie', view: 'star', pin: 'heart', share: 'sparkles' },
    decorLeft: [
      { glyph: 'heart', size: 62, x: 46, y: 22, rotate: -10, opacity: 0.95 },
      { glyph: 'heart', size: 44, x: 52, y: 56, rotate: 8, opacity: 0.7 },
    ],
    decorRight: [
      { glyph: 'heart', size: 74, x: 48, y: 34, rotate: 6 },
    ],
    builtin: true,
  },
  // 八月十四 ~ 十六：月金 + 夜空，两者叠加出「赏月」的氛围
  {
    id: 'mid-autumn',
    priority: 90,
    schedule: { lunar: [[8, 14], [8, 16]] },
    tokens: {
      hue: 75,
      chroma: 0.12,
      primaryL: 0.52,
      primaryLDark: 0.8,
      overlay: 'radial-gradient(30% 24% at 84% 6%, oklch(0.96 0.12 88 / 0.38), transparent 70%), radial-gradient(120% 62% at 50% -10%, oklch(0.6 0.07 265 / 0.14), transparent 62%)',
      overlayDark: 'radial-gradient(30% 24% at 84% 6%, oklch(0.88 0.13 88 / 0.26), transparent 70%), radial-gradient(120% 62% at 50% -10%, oklch(0.4 0.08 265 / 0.4), transparent 62%)',
      primaryImage: 'linear-gradient(160deg, oklch(0.95 0.1 90 / 0.3), transparent 58%)',
    },
    effect: 'stars',
    mode: 'dark',
    icons: { like: 'mooncake', comment: 'rabbit', view: 'moon', pin: 'star', share: 'sparkles' },
    decorLeft: [
      { glyph: 'moon', size: 124, x: 46, y: 16 },
      { glyph: 'rabbit', size: 84, x: 42, y: 62, rotate: -4 },
      { glyph: 'mooncake', size: 62, x: 56, y: 86, rotate: 8, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'rabbit', size: 76, x: 48, y: 26, rotate: 6, opacity: 0.95, flip: true },
      { glyph: 'mooncake', size: 88, x: 46, y: 68, rotate: -6 },
    ],
    builtin: true,
  },
  // 九月初八 ~ 初十：菊黄，暖而不艳
  {
    id: 'double-ninth',
    priority: 55,
    schedule: { lunar: [[9, 8], [9, 10]] },
    tokens: {
      hue: 50,
      chroma: 0.13,
      primaryL: 0.54,
      primaryLDark: 0.78,
      overlay: 'radial-gradient(66% 46% at 50% -10%, oklch(0.84 0.13 70 / 0.2), transparent 72%)',
      overlayDark: 'radial-gradient(66% 46% at 50% -10%, oklch(0.6 0.13 68 / 0.26), transparent 72%)',
    },
    mode: 'light',
    icons: { like: 'chrysanthemum', comment: 'flower', view: 'leaf', pin: 'star', share: 'sparkles' },
    decorLeft: [
      { glyph: 'daisy', size: 92, x: 47, y: 26, rotate: -6 },
      { glyph: 'daisy', size: 58, x: 40, y: 68, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'daisy', size: 76, x: 50, y: 46, rotate: 6 },
    ],
    builtin: true,
  },
  // 4/4 ~ 4/6：清明是节气不是农历日期，用固定公历窗口近似；配色刻意素雅，不做喜庆装饰
  {
    id: 'qingming',
    priority: 40,
    schedule: { solar: [[4, 4], [4, 6]] },
    tokens: {
      hue: 165,
      chroma: 0.09,
      primaryL: 0.5,
      primaryLDark: 0.74,
      overlay: 'radial-gradient(90% 60% at 50% -14%, oklch(0.86 0.05 175 / 0.2), transparent 74%)',
      overlayDark: 'radial-gradient(90% 60% at 50% -14%, oklch(0.55 0.05 175 / 0.24), transparent 74%)',
    },
    mode: 'light',
    icons: { like: 'cloud-rain', comment: 'leaf', view: 'cloud-rain', pin: 'leaf', share: 'sparkles' },
    builtin: true,
  },
]
