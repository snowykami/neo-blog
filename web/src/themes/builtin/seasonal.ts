import type { ThemeDefinition } from '../types'

/**
 * 季节性主题：不是节日，只是固定的月份窗口。
 * 与节日主题共用同一套机制，区别仅在于触发规则的语义。
 */
export const SEASONAL_THEMES: ThemeDefinition[] = [
  // 3/20 ~ 4/15：樱花季，粉白柔光 + 花瓣飘落
  {
    id: 'sakura',
    priority: 50,
    schedule: { solar: [[3, 20], [4, 15]] },
    tokens: {
      hue: 340,
      chroma: 0.11,
      primaryL: 0.58,
      primaryLDark: 0.78,
      overlay: 'radial-gradient(64% 46% at 50% -10%, oklch(0.88 0.09 345 / 0.26), transparent 72%), radial-gradient(44% 32% at 0% 100%, oklch(0.9 0.07 20 / 0.14), transparent 74%)',
      overlayDark: 'radial-gradient(64% 46% at 50% -10%, oklch(0.6 0.1 345 / 0.28), transparent 72%), radial-gradient(44% 32% at 0% 100%, oklch(0.6 0.08 20 / 0.18), transparent 74%)',
    },
    effect: 'sakura',
    mode: 'light',
    icons: { like: 'sakura', comment: 'flower', view: 'leaf', pin: 'sakura', share: 'sparkles' },
    decorLeft: [
      { glyph: 'sakura-branch', size: 132, x: 46, y: 20 },
      { glyph: 'sakura-branch', size: 96, x: 44, y: 74, opacity: 0.9, flip: true },
    ],
    decorRight: [
      { glyph: 'sakura-branch', size: 118, x: 50, y: 52 },
    ],
    builtin: true,
  },
  // 6/10 ~ 7/10：毕业季，蓝白
  {
    id: 'graduation',
    priority: 35,
    schedule: { solar: [[6, 10], [7, 10]] },
    tokens: {
      hue: 230,
      chroma: 0.12,
      primaryL: 0.55,
      primaryLDark: 0.75,
      overlay: 'radial-gradient(66% 46% at 50% -10%, oklch(0.84 0.08 230 / 0.2), transparent 72%)',
      overlayDark: 'radial-gradient(66% 46% at 50% -10%, oklch(0.56 0.1 230 / 0.28), transparent 72%)',
    },
    mode: 'light',
    icons: { like: 'graduation-cap', comment: 'star', view: 'leaf', pin: 'graduation-cap', share: 'sparkles' },
    decorLeft: [
      { glyph: 'cap', size: 96, x: 47, y: 24, rotate: -8 },
      { glyph: 'cap', size: 56, x: 40, y: 66, rotate: 10, opacity: 0.9 },
    ],
    decorRight: [
      { glyph: 'cap', size: 76, x: 50, y: 46, rotate: 6 },
    ],
    builtin: true,
  },
]
