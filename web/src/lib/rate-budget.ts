/**
 * 进程内的固定窗口计数：每个窗口最多放行 limit 次。只用来保护本进程的 CPU（如错误上报的调用栈还原），
 * 不是跨实例的限流（那个在后端，按 IP 计数并存在共享状态里）
 */
export function createRateBudget(limit: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = now()
  let used = 0
  return function take(): boolean {
    const at = now()
    if (at - windowStart >= windowMs) {
      windowStart = at
      used = 0
    }
    if (used >= limit)
      return false
    used++
    return true
  }
}
