/**
 * 错误报告附带的应用状态（如正在播放的歌曲与位置）：各模块注册一个读取函数，上报错误时与崩溃检测的心跳中读取，
 * 只放排查需要的少量字段，不放个人信息
 */
type ContextGetter = () => Record<string, unknown> | null

const getters = new Map<string, ContextGetter>()

/** 注册一项上下文，返回注销函数 */
export function registerTelemetryContext(name: string, getter: ContextGetter) {
  getters.set(name, getter)
  return () => {
    if (getters.get(name) === getter)
      getters.delete(name)
  }
}

/** 读取全部已注册的上下文；读取出错的项跳过 */
export function collectTelemetryContexts(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [name, getter] of getters) {
    try {
      const value = getter()
      if (value)
        result[name] = value
    }
    catch {}
  }
  return result
}
