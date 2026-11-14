// 此文件由 scripts/gen-content-components.mjs 生成，请勿手动修改
// 前台读路径专用：组件名 → 按需加载纯展示视图（直接指向视图模块，彻底跳过 *.content.ts 与 zod）
// 若需完整 schema / 默认值 / 编辑器配置（写路径），请仅在后台代码中使用 registry.ts
import type { RuntimeContentComponentSpec } from './runtime'

export const CONTENT_COMPONENT_LOADERS: Record<string, RuntimeContentComponentSpec> = {
  alert: { version: 1, load: () => import('@/components/ui/alert.content-view') },
  badges: { version: 1, load: () => import('@/components/ui/badge.content-view') },
  callout: { version: 1, load: () => import('@/components/content-components/callout/callout') },
  card: { version: 1, load: () => import('@/components/ui/card.content-view') },
  chart: { version: 1, load: () => import('@/components/ui/chart.content-view') },
  codeTabs: { version: 1, heights: [2, 3, 4, 5, 6, 7], load: () => import('@/components/content-components/code-tabs/code-tabs') },
  collapsible: { version: 1, load: () => import('@/components/ui/collapsible.content-view') },
  githubRepo: { version: 1, heights: [2, 3, 4], load: () => import('@/components/content-components/github-repo/github-repo') },
  linkButton: { version: 1, load: () => import('@/components/ui/button.content-view') },
  linkCard: { version: 1, load: () => import('@/components/common/link-preview-card.content-view') },
  lyricQuote: { version: 1, load: () => import('@/components/content-components/lyric-quote/lyric-quote') },
  neteaseSong: { version: 1, heights: [2, 3, 4, 5, 6, 7], load: () => import('@/components/content-components/netease-song/netease-song') },
  postRef: { version: 1, load: () => import('@/components/content-components/post-ref/post-ref') },
  progress: { version: 1, load: () => import('@/components/ui/progress.content-view') },
  shortcut: { version: 1, load: () => import('@/components/ui/kbd.content-view') },
  textTabs: { version: 1, load: () => import('@/components/ui/tabs.content-view') },
  weatherCard: { version: 1, heights: [2, 3, 4], load: () => import('@/components/content-components/weather-card/weather-card') },
}
