'use client'

import { getSvgPath } from 'figma-squircle'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 展开面板的连续曲率圆角，与胶囊同一套观感（胶囊的轮廓自己算，见 continuous-capsule.ts）。
 * border-radius 画的是正圆弧：直边曲率为 0，进入圆弧的一瞬间跳到 1/r，32px 这样的大圆角上一眼能看出交界处的棱；
 * Apple 的连续圆角把这段过渡沿直边拉长，曲率从 0 连续地升上去。这里用 Figma 的 corner smoothing
 * （figma-squircle，也就是 corner-smoothing 底下的那个算法库）生成轮廓。
 *
 * 面板用 clip-path 裁成这条轮廓，代价是面板自身的 box-shadow 与 ring 会被一起裁掉：
 * - 1px 细线改由面板里的 <path> 描边画出：描边跨在边界上，外侧那一半被裁掉，剩 1px，与胶囊的描边同法
 * - 阴影交给弹层外层（Radix 的 popper wrapper）的 drop-shadow 滤镜：滤镜作用在裁好的子树上，形状自然跟着走
 */

/** 与 PANEL_RADIUS_CLASS 的 2rem 一致：形变期间 motion / island-morph 按它插值圆角 */
export const PANEL_CORNER_RADIUS = 32
/** 0 ~ 1，iOS 观感约 0.6（Figma 里的默认值） */
export const PANEL_CORNER_SMOOTHING = 0.6
/** 面板自己的 shadow-2xl 被裁掉之后，改画在弹层外层上的柔和投影（drop-shadow 没有 spread，按原来的偏移与模糊折算） */
export const PANEL_SHADOW_FILTER = 'drop-shadow(0 18px 28px rgb(0 0 0 / 0.32))'

/** 宽 width、高 height（CSS 像素）的连续曲率矩形轮廓；尺寸无效时返回 null，由调用方保留普通圆角 */
export function squirclePath(width: number, height: number): string | null {
  if (!(width > 0 && height > 0))
    return null
  return getSvgPath({ width, height, cornerRadius: PANEL_CORNER_RADIUS, cornerSmoothing: PANEL_CORNER_SMOOTHING })
}

/**
 * 把面板裁成连续曲率的矩形，并返回同一条路径供 1px 描边使用（两者由同一个函数生成，必然重合）。
 * 尺寸变化（切换活动、面板内容不同）时按 ResizeObserver 重新生成；形变期间 clip-path 由 island-morph 的动画接管，
 * 动画结束后取消，行内这条重新生效。
 */
export function useSquirclePanel() {
  const [path, setPath] = useState<string | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    // 面板被裁之后自己的阴影不再可见，改画在弹层外层上；形变期间由 island-morph 暂时撤掉
    if (node?.parentElement)
      node.parentElement.style.filter = PANEL_SHADOW_FILTER
    if (!node) {
      setPath(null)
      return
    }
    const update = () => {
      const next = squirclePath(node.clientWidth, node.clientHeight)
      node.style.clipPath = next ? `path("${next}")` : ''
      setPath(next)
    }
    update()
    observerRef.current = new ResizeObserver(update)
    observerRef.current.observe(node)
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  return { ref, path }
}
