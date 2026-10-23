import type { z } from 'zod'
import type { AnyContentComponentDef } from './types'
import { getContentComponent } from './registry'

/** 读取 data-props：非法 JSON 时返回 null */
export function parsePropsAttr(raw: string | null | undefined): unknown {
  if (!raw)
    return null
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

/**
 * 序列化为 data-props：转义 < > &，避免属性值中出现 `-->`、`</style>` 等片段
 * 被净化器（DOMPurify 的 SAFE_FOR_XML）整条移除，JSON.parse 可直接还原
 */
export function serializePropsAttr(props: unknown): string {
  return JSON.stringify(props ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * 插入组件时的初始 props（schema 中的默认值）：逐个字段取默认值，
 * 对象级的条件校验（如某种模式下必填）不参与，插入后由作者在属性弹窗中补全
 */
export function getDefaultProps(def: AnyContentComponentDef): Record<string, unknown> {
  return Object.fromEntries(Object.entries(def.schema.shape).map(([key, field]) => [key, (field as z.ZodType).parse(undefined)]))
}

export type ResolvedComponent
  = | { ok: true, def: AnyContentComponentDef, props: Record<string, unknown> }
    | { ok: false, reason: 'unknown' | 'invalid', def?: AnyContentComponentDef }

/** 按组件名与 props 解析：未知组件、版本过高或 props 校验失败时返回 ok: false，由调用方保留降级内容 */
export function resolveComponent(name: string | null | undefined, props: unknown, version?: number | null): ResolvedComponent {
  const def = getContentComponent(name)
  if (!def || (version != null && version > def.version))
    return { ok: false, reason: 'unknown' }
  const result = def.schema.safeParse(props ?? {})
  if (!result.success)
    return { ok: false, reason: 'invalid', def }
  return { ok: true, def, props: result.data as Record<string, unknown> }
}

/** 读取占位元素上的组件信息 */
export function resolveComponentElement(el: Element): ResolvedComponent {
  const version = Number.parseInt(el.getAttribute('data-version') ?? '', 10)
  return resolveComponent(el.getAttribute('data-component'), parsePropsAttr(el.getAttribute('data-props')), Number.isNaN(version) ? null : version)
}
