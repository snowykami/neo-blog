// 此文件由 scripts/gen-content-components.mjs 生成，请勿手动修改
// 组件名 → 按需加载定义模块（只取 component 字段渲染，schema 与 zod 留在后台/编辑器侧）
import type { AnyContentComponentDef } from './types'

export const CONTENT_COMPONENT_LOADERS: Record<string, () => Promise<{ default: AnyContentComponentDef }>> = {
  alert: () => import('@/components/ui/alert.content'),
  badges: () => import('@/components/ui/badge.content'),
  callout: () => import('@/components/content-components/callout/callout.content'),
  card: () => import('@/components/ui/card.content'),
  chart: () => import('@/components/ui/chart.content'),
  codeTabs: () => import('@/components/content-components/code-tabs/code-tabs.content'),
  collapsible: () => import('@/components/ui/collapsible.content'),
  githubRepo: () => import('@/components/content-components/github-repo/github-repo.content'),
  linkButton: () => import('@/components/ui/button.content'),
  linkCard: () => import('@/components/common/link-preview-card.content'),
  lyricQuote: () => import('@/components/content-components/lyric-quote/lyric-quote.content'),
  neteaseSong: () => import('@/components/content-components/netease-song/netease-song.content'),
  postRef: () => import('@/components/content-components/post-ref/post-ref.content'),
  progress: () => import('@/components/ui/progress.content'),
  shortcut: () => import('@/components/ui/kbd.content'),
  textTabs: () => import('@/components/ui/tabs.content'),
  weatherCard: () => import('@/components/content-components/weather-card/weather-card.content'),
}
