/**
 * motion 按需加载：组件用 `m.*` 代替 `motion.*`，外面包 `<LazyMotion features={loadMotionFeatures} strict>`。
 * `m` 只带渲染与样式，动画、布局动画、手势等特性在水合后再取（domMax，灵动岛的布局形变需要）；
 * 首屏的样式与 `motion.*` 相同（`initial={false}` 时直接是 animate 的终值），特性到达后才开始播放动画。
 * 全站共用这一个加载函数，几个 LazyMotion 只会取同一个块
 */
export const loadMotionFeatures = () => import('./features').then(mod => mod.default)
