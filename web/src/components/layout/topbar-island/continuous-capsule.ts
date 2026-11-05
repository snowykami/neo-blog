/**
 * 连续曲率的胶囊轮廓（学 Apple 的 continuous corner）。
 * border-radius 画的是正圆弧：直边的曲率为 0，进入圆弧的一瞬间跳到 1/r，交界处看起来有一道棱；
 * Apple 的连续圆角让曲率在交界处从 0 逐渐升上去，过渡段沿直边延伸到 1.528665r（CALayer 的 cornerCurveExpansionFactor）。
 * 这里每个端头的四分之一由一段三次贝塞尔（从直边过渡到圆弧，两端曲率都连续）加一段圆弧组成，圆弧经过端头最远处，端头仍然圆润。
 * CSS corner-shape 的超椭圆在端头最远处曲率也为 0，胶囊两端会被压平，所以不用它。
 *
 * 参数为数值求解的结果（单位为半高 r）：圆弧半径 0.95r、过渡段转过 36°、过渡起点距端头 1.5266r；
 * 过渡段曲率单调上升、不鼓包，整个轮廓落在原来的半圆胶囊之内，最多内缩约 0.033r（36px 高时约 0.6px）
 */

const ARC_RADIUS = 0.95
const TRANSITION_RAD = (36 * Math.PI) / 180
// 过渡起点在第一个控制点之外再延伸的长度：控制点之间留出余量，曲率爬升得更平缓
const LEAD = 0.4

interface Point {
  x: number
  y: number
}

/**
 * 端头四分之一的贝塞尔控制点（单位为半高 r；x 从端头最远处起算，y 从顶边起算向下）：
 * p0 为直边上过渡的起点，p3 为过渡与圆弧的交点。p0、p1、p2 都在直边上，起点曲率为 0；
 * p2 为圆弧在 p3 处的切线与直边的交点，p1 的位置使 p3 处的曲率等于圆弧的曲率
 */
const QUARTER = (() => {
  const p3 = { x: ARC_RADIUS * (1 - Math.sin(TRANSITION_RAD)), y: ARC_RADIUS * Math.cos(TRANSITION_RAD) }
  const tangent = (1 - p3.y) / Math.sin(TRANSITION_RAD)
  const p2x = p3.x + tangent * Math.cos(TRANSITION_RAD)
  const p1x = p2x + (1.5 * tangent * tangent) / (ARC_RADIUS * Math.sin(TRANSITION_RAD))
  const toTop = (point: Point) => ({ x: point.x, y: 1 - point.y })
  return {
    p0: { x: p1x + LEAD, y: 0 },
    p1: { x: p1x, y: 0 },
    p2: { x: p2x, y: 0 },
    p3: toTop(p3),
  }
})()

/** 胶囊至少要这么宽（单位为高度），两端的过渡段才放得下；更窄时返回 null，由调用方保留普通圆角 */
export const CONTINUOUS_CAPSULE_MIN_ASPECT = QUARTER.p0.x

/** 宽 width、高 height（CSS 像素）的连续曲率胶囊，返回 SVG 路径（可用于 clip-path: path() 与 <path d>）；太窄时返回 null */
export function continuousCapsulePath(width: number, height: number): string | null {
  if (!(width > 0 && height > 0) || width < height * CONTINUOUS_CAPSULE_MIN_ASPECT)
    return null
  const r = height / 2
  const n = (value: number) => Number(value.toFixed(2))
  // 左端点按 x 从左边缘起算，右端点镜像；上半按 y 从顶边起算，下半镜像
  const left = (p: Point) => n(p.x * r)
  const right = (p: Point) => n(width - p.x * r)
  const top = (p: Point) => n(p.y * r)
  const bottom = (p: Point) => n(height - p.y * r)
  const { p0, p1, p2, p3 } = QUARTER
  const arc = n(ARC_RADIUS * r)
  const h = n(height)
  return [
    `M${left(p0)} 0`,
    `H${right(p0)}`,
    `C${right(p1)} 0 ${right(p2)} 0 ${right(p3)} ${top(p3)}`,
    `A${arc} ${arc} 0 0 1 ${right(p3)} ${bottom(p3)}`,
    `C${right(p2)} ${h} ${right(p1)} ${h} ${right(p0)} ${h}`,
    `H${left(p0)}`,
    `C${left(p1)} ${h} ${left(p2)} ${h} ${left(p3)} ${bottom(p3)}`,
    `A${arc} ${arc} 0 0 1 ${left(p3)} ${top(p3)}`,
    `C${left(p2)} 0 ${left(p1)} 0 ${left(p0)} 0`,
    'Z',
  ].join(' ')
}
