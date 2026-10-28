/**
 * 三次贝塞尔缓动（与 CSS cubic-bezier 相同）：已知 x 用牛顿迭代 + 二分求曲线参数 t，再求 y
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx

  const solve = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x
      if (Math.abs(error) < 1e-5)
        return t
      const slope = slopeX(t)
      if (Math.abs(slope) < 1e-6)
        break
      t -= error / slope
    }
    // 牛顿迭代不收敛时二分
    let low = 0
    let high = 1
    t = x
    for (let i = 0; i < 20; i++) {
      if (sampleX(t) < x)
        low = t
      else
        high = t
      t = (low + high) / 2
    }
    return t
  }

  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)))
}

const swellIn = cubicBezier(0.2, 0.4, 0.58, 1)
const swellOut = cubicBezier(0.3, 0, 0.58, 1)

/**
 * 强调的起落曲线（参考 AMLL）：前半程较快地升到顶点，后半程缓缓回落；x、返回值均为 0 ~ 1，两端为 0、中点为 1
 */
export function swellCurve(x: number): number {
  if (x <= 0 || x >= 1)
    return 0
  return x < 0.5 ? swellIn(x / 0.5) : 1 - swellOut((x - 0.5) / 0.5)
}
