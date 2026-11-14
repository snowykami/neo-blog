import type { RegisteredContentComponent } from './types'
import { GENERATED_CONTENT_COMPONENTS } from './registry.generated'

/**
 * 【仅限后台编辑器 / 写路径使用】组件完整注册表：
 * 本模块导入 registry.generated.ts，会静态拉入全部 *.content.ts(x) 及其 zod schema（约 144 KiB raw / 42 KiB gzip）。
 * 前台访客侧（如 component-islands.tsx、blog-sidebar-card.tsx、(main) 路由）严禁静态或动态导入本模块；
 * 前台解析与按需加载纯视图请改用 `./runtime`。
 *
 * 组件定义按约定放在组件旁的 <名称>.content.ts(x)（默认导出 defineContentComponent），
 * 由 scripts/gen-content-components.mjs 自动收集；新增组件后运行 pnpm gen:content 并补齐 ContentComponents 下的文案
 */
export const CONTENT_COMPONENTS: RegisteredContentComponent[] = GENERATED_CONTENT_COMPONENTS
  .map(({ path, def }) => ({ ...def, path }))

const componentMap = new Map(CONTENT_COMPONENTS.map(def => [def.name, def]))

export function getContentComponent(name: string | null | undefined): RegisteredContentComponent | undefined {
  return name ? componentMap.get(name) : undefined
}
