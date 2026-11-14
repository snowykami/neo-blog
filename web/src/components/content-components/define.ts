import type { z } from 'zod'
import type { AnyContentComponentDef, ContentComponentDef } from './types'

/**
 * 定义组件（写路径 / 编辑器专用）：保留 schema 的具体类型，用于约束组件与降级函数的 props。
 * 拆分约束：包含 zod schema 的定义必须留在 `*.content.ts(x)` 或独立 `schema.ts`；
 * `component` 字段指向的纯展示视图严禁反向导入（含 `import type`）定义文件、schema 或 zod，确保前台 0 Zod 运行时
 */
export function defineContentComponent<S extends z.ZodObject>(def: ContentComponentDef<S>): AnyContentComponentDef {
  return def as unknown as AnyContentComponentDef
}
