/**
 * 【前台读路径专用 · 0 Zod】文章组件运行时解析与纯视图按需加载器。
 *
 * 为什么前台无需重跑 zod 校验：
 * - 正文 `[data-component]` 与侧边栏 `sidebarCards` 在后台保存及服务端 HTML 净化阶段已完成严格 schema 校验；
 * - 访客端只需核对组件名、版本号与 JSON 对象结构，再按需加载纯展示视图；即使遇到历史脏数据导致视图渲染抛错，
 *   外层 `ContentView` 的 `ComponentErrorBoundary` 也会捕获并恢复静态降级 HTML。
 * - 防退化约束：本文件严禁引入 `zod`、`./registry`、`./props` 或任何 `*.content.ts`。
 */
import type { ComponentType } from 'react'
import type { ComponentHeight } from './layout'
import { lazy } from 'react'
import { CONTENT_COMPONENT_LOADERS } from './runtime-registry.generated'

/** 运行时注册表条目：只包含版本号、支持高度与纯展示组件懒加载函数，不含 schema 与 zod */
export interface RuntimeContentComponentSpec {
  version: number
  heights?: readonly ComponentHeight[]
  load: () => Promise<{ default: ComponentType<any> }>
}

export interface RuntimeContentComponent {
  name: string
  version: number
  heights?: readonly ComponentHeight[]
  component: ComponentType<any>
}

export type ResolvedRuntimeComponent
  = | { ok: true, entry: RuntimeContentComponent, props: Record<string, unknown> }
    | { ok: false, reason: 'unknown' | 'invalid' }

const runtimeComponentCache = new Map<string, RuntimeContentComponent>()

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

/** 按组件名与版本号获取运行时按需加载组件（缓存 React.lazy 包装，避免重渲染时重新挂起） */
export function getRuntimeContentComponent(name: string | null | undefined, version?: number | null): RuntimeContentComponent | null {
  if (!name || !Object.hasOwn(CONTENT_COMPONENT_LOADERS, name))
    return null
  const spec = CONTENT_COMPONENT_LOADERS[name]
  if (version != null && version > spec.version)
    return null
  let cached = runtimeComponentCache.get(name)
  if (!cached) {
    cached = {
      name,
      version: spec.version,
      heights: spec.heights,
      component: lazy(spec.load),
    }
    runtimeComponentCache.set(name, cached)
  }
  return cached
}

/** 读取占位元素上的组件名、版本与 JSON props（不加载 schema 与 zod） */
export function resolveRuntimeComponentElement(el: Element): ResolvedRuntimeComponent {
  const name = el.getAttribute('data-component')
  const rawVersion = Number.parseInt(el.getAttribute('data-version') ?? '', 10)
  const entry = getRuntimeContentComponent(name, Number.isNaN(rawVersion) ? null : rawVersion)
  if (!entry)
    return { ok: false, reason: 'unknown' }

  const rawProps = el.getAttribute('data-props')
  const parsed = rawProps ? parsePropsAttr(rawProps) : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ok: false, reason: 'invalid' }

  return { ok: true, entry, props: parsed as Record<string, unknown> }
}
