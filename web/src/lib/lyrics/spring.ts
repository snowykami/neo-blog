/**
 * 阻尼弹簧（见 spec 8.4）：以秒为时间单位逐帧推进，支持延迟启动（阶梯入场）与瞬移。
 * 使用固定子步长的半隐式欧拉积分，掉帧（单帧时间差较大）时也能保持稳定
 */

export interface SpringParams {
  mass: number
  stiffness: number
  damping: number
}

const SUB_STEP = 1 / 120
// 位置与速度都足够小时视为静止，避免无意义的逐帧更新
const REST_DISTANCE = 0.01
const REST_VELOCITY = 0.01

export class Spring {
  position: number
  private velocity = 0
  private target: number
  private delay = 0

  constructor(initial: number, private params: SpringParams) {
    this.position = initial
    this.target = initial
  }

  /** 设定目标；传入 delay 时 delay 秒后才开始向目标移动，不传则保留尚未结束的延迟 */
  setTarget(target: number, delay?: number) {
    this.target = target
    if (delay !== undefined)
      this.delay = delay
  }

  /** 瞬移到位，不经过弹簧（跳转、重建、减少动态效果时） */
  jump(target: number) {
    this.target = target
    this.position = target
    this.velocity = 0
    this.delay = 0
  }

  get resting(): boolean {
    return this.delay <= 0 && Math.abs(this.position - this.target) < REST_DISTANCE && Math.abs(this.velocity) < REST_VELOCITY
  }

  /** 推进 dt 秒；静止时直接对齐目标 */
  step(dt: number) {
    if (this.delay > 0) {
      this.delay -= dt
      if (this.delay > 0)
        return
      dt = -this.delay
      this.delay = 0
    }
    const { mass, stiffness, damping } = this.params
    for (let remaining = dt; remaining > 0; remaining -= SUB_STEP) {
      const h = Math.min(SUB_STEP, remaining)
      const acceleration = (-stiffness * (this.position - this.target) - damping * this.velocity) / mass
      this.velocity += acceleration * h
      this.position += this.velocity * h
    }
    if (this.resting) {
      this.position = this.target
      this.velocity = 0
    }
  }
}
