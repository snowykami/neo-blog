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
  private _velocity = 0
  private target: number
  private delay = 0

  constructor(initial: number, private params: SpringParams) {
    this.position = initial
    this.target = initial
  }

  get velocity(): number {
    return this._velocity
  }

  /** 动态更新弹簧物理参数（切换全曲律动预设或快切阻尼保护时平滑衔接，不改变当前位移与速度） */
  setParams(params: SpringParams) {
    this.params = params
  }

  /**
   * 设定目标；传入 delay 时延迟启动，不传则保留尚未结束的延迟。
   * 当弹簧已朝同一方向高速运动中（如连续快句切换）时，不硬刹停半空速度，大幅收短附加延迟以保持动量连贯
   */
  setTarget(target: number, delay?: number) {
    const delta = target - this.position
    if (delay !== undefined) {
      if (delay > 0 && Math.abs(this._velocity) > 8 && delta * this._velocity > 0)
        this.delay = Math.min(delay * 0.2, 0.014)
      else
        this.delay = delay
    }
    this.target = target
  }

  /** 瞬移到位，不经过弹簧（跳转、重建、减少动态效果时） */
  jump(target: number) {
    this.target = target
    this.position = target
    this._velocity = 0
    this.delay = 0
  }

  get resting(): boolean {
    return this.delay <= 0 && Math.abs(this.position - this.target) < REST_DISTANCE && Math.abs(this._velocity) < REST_VELOCITY
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
      const acceleration = (-stiffness * (this.position - this.target) - damping * this._velocity) / mass
      this._velocity += acceleration * h
      this.position += this._velocity * h
    }
    if (this.resting) {
      this.position = this.target
      this._velocity = 0
    }
  }
}
