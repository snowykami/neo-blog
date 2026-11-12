import { describe, expect, it } from 'vitest'
import {
  applyEdgeResistance,
  clampTransform,
  classifyWheelAction,
  computeDoubleTapScale,
  computeFlipTransform,
  computePointerVelocity,
  computeVerticalDismissVisual,
  IDENTITY_TRANSFORM,
  lockGestureAxis,
  resolveHorizontalSwipe,
  shouldDismissOnVerticalRelease,
  zoomTransformAtPoint,
} from './image-viewer-gesture'

describe('image-viewer-gesture', () => {
  describe('clampTransform 与旋转边界限制', () => {
    it('接近 1x 的微小残留倍率会自动吸附回初始居中状态', () => {
      const res = clampTransform(
        { scale: 1.008, x: 45, y: -30 },
        { width: 800, height: 600 },
        { width: 1200, height: 900 },
      )
      expect(res).toEqual(IDENTITY_TRANSFORM)
    })

    it('放大后平移不会超出可视舞台边缘', () => {
      // 图片基础尺寸 800x600，放大 2x 后 1600x1200，舞台 1000x800 -> maxX = 300, maxY = 200
      const res = clampTransform(
        { scale: 2, x: 520, y: -480 },
        { width: 800, height: 600 },
        { width: 1000, height: 800 },
      )
      expect(res).toEqual({ scale: 2, x: 300, y: -200 })
    })

    it('旋转 90° 后按宽高互换后的视觉边界进行约束', () => {
      // 基础 800x400，旋转 90° 后视觉 400x800，放大 2x 后 800x1600，舞台 1000x1000 -> maxX = 0, maxY = 300
      const res = clampTransform(
        { scale: 2, x: 200, y: 450 },
        { width: 800, height: 400 },
        { width: 1000, height: 1000 },
        90,
      )
      expect(res).toEqual({ scale: 2, x: 0, y: 300 })
    })
  })

  describe('zoomTransformAtPoint 与智能双击倍率', () => {
    it('以指定锚点缩放时保持锚点不偏移且受舞台边界保护', () => {
      const next = zoomTransformAtPoint(
        IDENTITY_TRANSFORM,
        2,
        { x: 100, y: -50 },
        { width: 800, height: 600 },
        { width: 1000, height: 800 },
      )
      // rawX = 100 - (100 - 0) * 2 = -100, rawY = -50 - (-50 - 0) * 2 = 50 (均在 [-300,300] / [-200,200] 内)
      expect(next).toEqual({ scale: 2, x: -100, y: 50 })
    })

    it('窄长截图双击时自动放大到接近视口可读宽度，而非死板的 2x', () => {
      // 手机视口宽 390，超长截图被等比压到只有 110px 宽，原始像素宽 1080
      const scale = computeDoubleTapScale(
        { width: 1080, height: 4800 },
        { width: 110, height: 490 },
        { width: 390, height: 844 },
      )
      // targetWidth = 390 * 0.94 = 366.6 -> 366.6 / 110 ≈ 3.33
      expect(scale).toBeGreaterThan(3)
      expect(scale).toBeLessThanOrEqual(5)
    })
  })

  describe('手势锁轴、边缘阻尼、水平轻扫与下拉关闭', () => {
    it('小于点击容差时不锁轴，超出后区分水平与垂直', () => {
      expect(lockGestureAxis(4, 5)).toBeNull()
      expect(lockGestureAxis(-22, 10)).toBe('horizontal')
      expect(lockGestureAxis(8, 26)).toBe('vertical')
    })

    it('首尾边界滑动有明显橡皮筋阻尼，非边界保持 1:1 跟手', () => {
      expect(applyEdgeResistance(-120, true, true)).toBe(-120)
      const damped = applyEdgeResistance(180, false, true)
      expect(damped).toBeGreaterThan(0)
      expect(damped).toBeLessThan(60)
    })

    it('支持短距离快速轻扫切图，且中途反向回甩可取消切换', () => {
      const samples = [
        { x: 200, y: 300, t: 100 },
        { x: 162, y: 302, t: 155 },
      ]
      const { vx } = computePointerVelocity(samples)
      expect(vx).toBeLessThan(-0.5)
      // 位移仅 38px（小于常规 60px），但轻扫速度够快，应切到下一张
      expect(resolveHorizontalSwipe(-38, vx, 390, true, true)).toBe(1)
      // 若向左拖了 120px 后突然向右回甩（vx > 0.25），视为取消
      expect(resolveHorizontalSwipe(-120, 0.4, 390, true, true)).toBe(0)
      // 已在最后一张时向左滑不会越界切换
      expect(resolveHorizontalSwipe(-150, -0.8, 390, true, false)).toBe(0)
    })

    it('下拉时图片缩小且背景渐透，达到位移或速度阈值触发关闭，上滑不误关', () => {
      const down = computeVerticalDismissVisual(20, 180)
      expect(down.scale).toBeLessThan(1)
      expect(down.backdropFactor).toBeLessThan(0.6)
      expect(shouldDismissOnVerticalRelease(130, 0.1)).toBe(true)
      expect(shouldDismissOnVerticalRelease(48, 0.7)).toBe(true)

      const up = computeVerticalDismissVisual(0, -120)
      expect(up.scale).toBe(1)
      expect(up.backdropFactor).toBe(1)
      expect(shouldDismissOnVerticalRelease(-120, -0.8)).toBe(false)
    })
  })

  describe('触控板双指滚动与滚轮/捏合缩放区分', () => {
    it('触控板双指捏合（ctrlKey=true）始终识别为缩放', () => {
      const action = classifyWheelAction(
        { ctrlKey: true, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: -8.5 },
        2.5,
        0,
        1000,
      )
      expect(action.type).toBe('zoom')
    })

    it('图片放大后触控板双指滑动识别为平移长图，而非误缩放', () => {
      const action = classifyWheelAction(
        { ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 4, deltaY: 18 },
        2.2,
        0,
        1000,
      )
      expect(action.type).toBe('pan')
      expect(action.dx).toBe(-4)
      expect(action.dy).toBe(-18)
    })

    it('传统离散鼠标滚轮在放大后仍识别为缩放', () => {
      const action = classifyWheelAction(
        { ctrlKey: false, metaKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 },
        2.2,
        0,
        2000,
      )
      expect(action.type).toBe('zoom')
    })
  })

  describe('共享元素 FLIP 变换计算', () => {
    it('源图片在视口内时精准计算中心偏移与几何比例，滚出视口外时返回 null', () => {
      const flip = computeFlipTransform(
        { left: 100, top: 200, right: 300, bottom: 350, width: 200, height: 150 },
        { left: 200, top: 100, right: 1000, bottom: 700, width: 800, height: 600 },
        { width: 1200, height: 800 },
      )
      expect(flip).toEqual({ scale: 0.25, x: -400, y: -125 })

      const offscreen = computeFlipTransform(
        { left: 100, top: -400, right: 300, bottom: -250, width: 200, height: 150 },
        { left: 200, top: 100, right: 1000, bottom: 700, width: 800, height: 600 },
        { width: 1200, height: 800 },
      )
      expect(offscreen).toBeNull()
    })
  })
})
