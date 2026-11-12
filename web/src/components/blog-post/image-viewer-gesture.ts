export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface Transform {
  scale: number
  x: number
  y: number
}

export interface PointerSample {
  x: number
  y: number
  t: number
}

export type GestureAxis = 'horizontal' | 'vertical' | null

export interface WheelClassification {
  type: 'zoom' | 'pan' | 'ignore'
  dx: number
  dy: number
  trackpadUntil: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 5
export const DEFAULT_DOUBLE_TAP_SCALE = 2
export const TAP_SLOP = 8 // 移动小于该距离视为点击（兼顾触屏手指微颤）
export const DOUBLE_TAP_MS = 280
export const DOUBLE_TAP_DISTANCE = 32
export const SLIDE_GAP = 24 // 相邻图片滑轨间距
export const SWIPE_VELOCITY_THRESHOLD = 0.35 // px/ms，轻扫切图速度阈值
export const SWIPE_MIN_FLICK_DISTANCE = 24 // 轻扫最小位移
export const DISMISS_DISTANCE_THRESHOLD = 110 // 下滑关闭位移阈值
export const DISMISS_VELOCITY_THRESHOLD = 0.55 // px/ms，快速下滑关闭速度阈值
export const SNAP_TO_IDENTITY_SCALE = 1.015 // 缩放到接近 1x 时吸附回原始状态，防止残留微小倍率锁死左右滑动

export const IDENTITY_TRANSFORM: Transform = { scale: 1, x: 0, y: 0 }

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale))
    return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** 考虑旋转角度（90°/270°）后图片在舞台坐标系中的有效宽高 */
export function effectiveFittedSize(fittedSize: Size, rotation = 0): Size {
  const quarterTurns = Math.round(rotation / 90) % 2
  if (quarterTurns !== 0)
    return { width: fittedSize.height, height: fittedSize.width }
  return fittedSize
}

/** 将放大后的平移偏移量限制在可视舞台边界内，避免把图片完全拖出屏幕 */
export function clampTransform(
  transform: Transform,
  fittedSize: Size,
  stageSize: Size,
  rotation = 0,
): Transform {
  const scale = clampScale(transform.scale)
  if (scale <= SNAP_TO_IDENTITY_SCALE)
    return IDENTITY_TRANSFORM
  if (fittedSize.width <= 0 || fittedSize.height <= 0 || stageSize.width <= 0 || stageSize.height <= 0)
    return { scale, x: transform.x, y: transform.y }

  const visual = effectiveFittedSize(fittedSize, rotation)
  const maxX = Math.max(0, (visual.width * scale - stageSize.width) / 2)
  const maxY = Math.max(0, (visual.height * scale - stageSize.height) / 2)

  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y)),
  }
}

/** 以舞台内相对中心偏移 pointOffset 为锚点缩放，并自动做边界约束 */
export function zoomTransformAtPoint(
  prev: Transform,
  nextScale: number,
  pointOffset: Point,
  fittedSize: Size,
  stageSize: Size,
  rotation = 0,
): Transform {
  const scale = clampScale(nextScale)
  if (scale <= SNAP_TO_IDENTITY_SCALE)
    return IDENTITY_TRANSFORM

  const safePrevScale = prev.scale > 0 ? prev.scale : MIN_SCALE
  const ratio = scale / safePrevScale
  const rawX = pointOffset.x - (pointOffset.x - prev.x) * ratio
  const rawY = pointOffset.y - (pointOffset.y - prev.y) * ratio

  return clampTransform({ scale, x: rawX, y: rawY }, fittedSize, stageSize, rotation)
}

/**
 * 根据图片原始分辨率与当前适配尺寸智能计算双击放大倍率：
 * - 窄长截图（宽度不足视口 60%）：优先放大到接近视口宽度，让文字清晰可读
 * - 普通图片：结合原图像素密度限制在 [2, 2.8]
 */
export function computeDoubleTapScale(
  naturalSize: Size,
  fittedSize: Size,
  stageSize: Size,
): number {
  if (fittedSize.width <= 0 || stageSize.width <= 0)
    return DEFAULT_DOUBLE_TAP_SCALE

  if (fittedSize.width < stageSize.width * 0.6) {
    const targetWidth = naturalSize.width > 0
      ? Math.min(stageSize.width * 0.94, Math.max(fittedSize.width * 2, naturalSize.width))
      : stageSize.width * 0.9
    return clampScale(Math.max(DEFAULT_DOUBLE_TAP_SCALE, targetWidth / fittedSize.width))
  }

  if (naturalSize.width > 0) {
    const pixelRatio = naturalSize.width / fittedSize.width
    return clampScale(Math.max(DEFAULT_DOUBLE_TAP_SCALE, Math.min(2.8, pixelRatio)))
  }

  return DEFAULT_DOUBLE_TAP_SCALE
}

/** 单指移动超过阈值后锁定手势方向：水平切图 vs 垂直下拉关闭 */
export function lockGestureAxis(dx: number, dy: number, slop = TAP_SLOP): GestureAxis {
  if (Math.hypot(dx, dy) <= slop)
    return null
  return Math.abs(dx) >= Math.abs(dy) * 0.85 ? 'horizontal' : 'vertical'
}

/** 首尾图片向外继续拖动时施加橡皮筋阻尼反馈 */
export function applyEdgeResistance(offset: number, canGoPrev: boolean, canGoNext: boolean): number {
  const atBoundary = (offset > 0 && !canGoPrev) || (offset < 0 && !canGoNext)
  if (!atBoundary)
    return offset
  return (offset / (1 + Math.abs(offset) / 180)) * 0.42
}

/** 基于最近约 100ms 的指针样本估算松手瞬时速度（px/ms） */
export function computePointerVelocity(samples: readonly PointerSample[]): { vx: number, vy: number } {
  if (samples.length < 2)
    return { vx: 0, vy: 0 }

  const last = samples[samples.length - 1]
  let anchor = samples[0]
  for (const sample of samples) {
    if (last.t - sample.t <= 100) {
      anchor = sample
      break
    }
  }

  const dt = last.t - anchor.t
  if (dt < 6)
    return { vx: 0, vy: 0 }

  return {
    vx: (last.x - anchor.x) / dt,
    vy: (last.y - anchor.y) / dt,
  }
}

/**
 * 综合滑动距离与轻扫速度判定水平切换方向：
 * 返回 -1（上一张）、1（下一张）或 0（回弹当前图）
 */
export function resolveHorizontalSwipe(
  rawDx: number,
  vx: number,
  stageWidth: number,
  canGoPrev: boolean,
  canGoNext: boolean,
): -1 | 0 | 1 {
  const distanceThreshold = Math.min(110, Math.max(48, stageWidth * 0.16))

  // 向左滑看下一张（若末尾突然向右回甩 vx > 0.25 则视为取消）
  if (rawDx < 0 && canGoNext && vx <= 0.25) {
    const distance = -rawDx
    if (distance >= distanceThreshold || (vx <= -SWIPE_VELOCITY_THRESHOLD && distance >= SWIPE_MIN_FLICK_DISTANCE))
      return 1
  }

  // 向右滑看上一张（若末尾突然向左回甩 vx < -0.25 则视为取消）
  if (rawDx > 0 && canGoPrev && vx >= -0.25) {
    if (rawDx >= distanceThreshold || (vx >= SWIPE_VELOCITY_THRESHOLD && rawDx >= SWIPE_MIN_FLICK_DISTANCE))
      return -1
  }

  return 0
}

/** 计算单指垂直拖拽时的跟手位移、缩放与背景遮罩不透明度系数 */
export function computeVerticalDismissVisual(rawDx: number, rawDy: number): {
  x: number
  y: number
  scale: number
  backdropFactor: number
} {
  if (rawDy <= 0) {
    // 向上拉施加阻尼，不触发关闭
    return {
      x: rawDx * 0.25,
      y: (rawDy / (1 + Math.abs(rawDy) / 160)) * 0.35,
      scale: 1,
      backdropFactor: 1,
    }
  }

  return {
    x: rawDx * 0.38,
    y: rawDy,
    scale: Math.max(0.68, 1 - rawDy / 900),
    backdropFactor: Math.max(0.15, 1 - rawDy / 360),
  }
}

/** 判断垂直拖拽松手时是否应关闭预览器 */
export function shouldDismissOnVerticalRelease(rawDy: number, vy: number): boolean {
  if (rawDy <= 0 || vy < -0.2)
    return false
  return rawDy >= DISMISS_DISTANCE_THRESHOLD || (rawDy >= 36 && vy >= DISMISS_VELOCITY_THRESHOLD)
}

/**
 * 区分滚轮缩放与触控板双指平移：
 * - 双指捏合 / Ctrl(Cmd)+滚轮 -> 始终定点缩放
 * - 放大状态下触控板双指滑动 -> 平移查看长图/大图细节
 * - 普通外接鼠标滚轮 -> 定点缩放
 */
export function classifyWheelAction(
  event: {
    ctrlKey: boolean
    metaKey: boolean
    deltaMode: number
    deltaX: number
    deltaY: number
  },
  currentScale: number,
  recentTrackpadUntil: number,
  now: number,
): WheelClassification {
  if (event.ctrlKey || event.metaKey) {
    return {
      type: 'zoom',
      dx: 0,
      dy: event.deltaY,
      trackpadUntil: recentTrackpadUntil,
    }
  }

  const looksLikeTrackpad = event.deltaMode === 0
    && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 40 || now < recentTrackpadUntil)
  const nextTrackpadUntil = looksLikeTrackpad ? now + 280 : recentTrackpadUntil

  if (looksLikeTrackpad) {
    if (currentScale > SNAP_TO_IDENTITY_SCALE) {
      return {
        type: 'pan',
        dx: -event.deltaX,
        dy: -event.deltaY,
        trackpadUntil: nextTrackpadUntil,
      }
    }
    // 1x 状态下触控板横向滑动不误触发图片缩放
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return {
        type: 'ignore',
        dx: 0,
        dy: 0,
        trackpadUntil: nextTrackpadUntil,
      }
    }
  }

  return {
    type: 'zoom',
    dx: 0,
    dy: event.deltaY,
    trackpadUntil: nextTrackpadUntil,
  }
}

/**
 * 计算打开/关闭共享元素过渡动画（FLIP）：
 * 返回从舞台目标矩形 targetRect 变换到页面源图片矩形 originRect 所需的位移与比例；
 * 若源图片不在当前视口内或尺寸无效，返回 null（回退为中心缩放淡入淡出）
 */
export function computeFlipTransform(
  originRect: Rect | null | undefined,
  targetRect: Rect | null | undefined,
  viewport: Size,
): Transform | null {
  if (!originRect || !targetRect)
    return null
  if (originRect.width <= 0 || originRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0)
    return null
  if (
    originRect.bottom <= 0
    || originRect.top >= viewport.height
    || originRect.right <= 0
    || originRect.left >= viewport.width
  ) {
    return null
  }

  const widthRatio = originRect.width / targetRect.width
  const heightRatio = originRect.height / targetRect.height
  const scale = Math.min(2, Math.max(0.08, Math.sqrt(widthRatio * heightRatio)))

  const originCenterX = originRect.left + originRect.width / 2
  const originCenterY = originRect.top + originRect.height / 2
  const targetCenterX = targetRect.left + targetRect.width / 2
  const targetCenterY = targetRect.top + targetRect.height / 2

  return {
    scale,
    x: originCenterX - targetCenterX,
    y: originCenterY - targetCenterY,
  }
}
