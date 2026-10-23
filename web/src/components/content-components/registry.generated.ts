// 此文件由 scripts/gen-content-components.mjs 根据 src/components/**/*.content.{ts,tsx} 生成，请勿手动修改
// 新增组件：在组件旁添加 <名称>.content.ts(x) 并默认导出 defineContentComponent(...)，然后运行 pnpm gen:content
import type { ContentComponentEntry } from './types'
import commonLinkPreviewCard from '@/components/common/link-preview-card.content'
import contentComponentsCallout from '@/components/content-components/callout/callout.content'
import contentComponentsCodeTabs from '@/components/content-components/code-tabs/code-tabs.content'
import contentComponentsGithubRepo from '@/components/content-components/github-repo/github-repo.content'
import contentComponentsNeteaseSong from '@/components/content-components/netease-song/netease-song.content'
import contentComponentsWeatherCard from '@/components/content-components/weather-card/weather-card.content'
import uiAlert from '@/components/ui/alert.content'
import uiBadge from '@/components/ui/badge.content'
import uiButton from '@/components/ui/button.content'
import uiCard from '@/components/ui/card.content'
import uiChart from '@/components/ui/chart.content'
import uiCollapsible from '@/components/ui/collapsible.content'
import uiKbd from '@/components/ui/kbd.content'
import uiProgress from '@/components/ui/progress.content'
import uiTabs from '@/components/ui/tabs.content'

export const GENERATED_CONTENT_COMPONENTS: ContentComponentEntry[] = [
  { path: 'common/link-preview-card', def: commonLinkPreviewCard },
  { path: 'content-components/callout', def: contentComponentsCallout },
  { path: 'content-components/code-tabs', def: contentComponentsCodeTabs },
  { path: 'content-components/github-repo', def: contentComponentsGithubRepo },
  { path: 'content-components/netease-song', def: contentComponentsNeteaseSong },
  { path: 'content-components/weather-card', def: contentComponentsWeatherCard },
  { path: 'ui/alert', def: uiAlert },
  { path: 'ui/badge', def: uiBadge },
  { path: 'ui/button', def: uiButton },
  { path: 'ui/card', def: uiCard },
  { path: 'ui/chart', def: uiChart },
  { path: 'ui/collapsible', def: uiCollapsible },
  { path: 'ui/kbd', def: uiKbd },
  { path: 'ui/progress', def: uiProgress },
  { path: 'ui/tabs', def: uiTabs },
]
