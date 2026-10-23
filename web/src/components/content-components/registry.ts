import type { AnyContentComponentDef } from './types'
import { calloutComponent } from './callout'
import { codeTabsComponent } from './code-tabs'
import { githubRepoComponent } from './github-repo'
import { neteaseSongComponent } from './netease-song'

/**
 * 组件注册表：只有在此注册（构建期打包）的组件才能在文章中使用
 * 正文中不保存任何代码，只保存组件名与 props；新增组件时同步补齐 ContentComponents 下的文案
 */
export const CONTENT_COMPONENTS: AnyContentComponentDef[] = [
  calloutComponent,
  codeTabsComponent,
  githubRepoComponent,
  neteaseSongComponent,
]

const componentMap = new Map(CONTENT_COMPONENTS.map(def => [def.name, def]))

export function getContentComponent(name: string | null | undefined): AnyContentComponentDef | undefined {
  return name ? componentMap.get(name) : undefined
}
