// 定义一系列motion动画用的曲线

export const liner = (t: number) => t

export const acceleration = (t: number) => t * t

export const deceleration = (t: number) => 1 - (1 - t) * (1 - t)
