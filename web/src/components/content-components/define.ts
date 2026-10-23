import type { z } from 'zod'
import type { AnyContentComponentDef, ContentComponentDef } from './types'

/** 定义组件：保留 schema 的具体类型，用于约束组件与降级函数的 props */
export function defineContentComponent<S extends z.ZodObject>(def: ContentComponentDef<S>): AnyContentComponentDef {
  return def as unknown as AnyContentComponentDef
}
