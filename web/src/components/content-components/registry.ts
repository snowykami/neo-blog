import type { RegisteredContentComponent } from './types'
import { GENERATED_CONTENT_COMPONENTS } from './registry.generated'

/**
 * 组件注册表：只有构建期打包的组件才能在文章中使用，正文中只保存组件名与 props
 * 组件定义按约定放在组件旁的 <名称>.content.ts(x)（默认导出 defineContentComponent），
 * 由 scripts/gen-content-components.mjs 自动收集；新增组件后运行 pnpm gen:content 并补齐 ContentComponents 下的文案
 */
export const CONTENT_COMPONENTS: RegisteredContentComponent[] = GENERATED_CONTENT_COMPONENTS
  .map(({ path, def }) => ({ ...def, path }))

const componentMap = new Map(CONTENT_COMPONENTS.map(def => [def.name, def]))

export function getContentComponent(name: string | null | undefined): RegisteredContentComponent | undefined {
  return name ? componentMap.get(name) : undefined
}
