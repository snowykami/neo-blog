import type { FeatureBundle } from 'motion/react'

/**
 * motion 按需加载：组件用 `m.*` 代替 `motion.*`，外面包 `<LazyMotion features={getMotionFeatures()} strict>`。
 * `m` 只带渲染与样式，动画、布局动画、手势等特性在水合后再取（domMax，灵动岛的布局形变需要）；
 * 首屏的样式与 `motion.*` 相同（`initial={false}` 时直接是 animate 的终值），特性到达后才开始播放动画。
 * 全站共用这一个加载与缓存：首屏异步取一次，取到后后续挂载直接同步拿到特性包，避免再次经过异步空窗期
 */
let resolvedFeatures: FeatureBundle | null = null
let loadingPromise: Promise<FeatureBundle> | null = null

export function loadMotionFeatures(): Promise<FeatureBundle> {
  loadingPromise ??= import('./features').then((mod) => {
    resolvedFeatures = mod.default
    return resolvedFeatures
  })
  return loadingPromise
}

export function getMotionFeatures(): FeatureBundle | (() => Promise<FeatureBundle>) {
  return resolvedFeatures ?? loadMotionFeatures
}
