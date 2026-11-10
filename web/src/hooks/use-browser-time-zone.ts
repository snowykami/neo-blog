import { useSyncExternalStore } from 'react'
import { getBrowserTimeZone } from '@/utils/common/time-zone'

const subscribe = () => () => {}

// 页面打开期间时区基本不会变，取一次即可（每次渲染都新建 Intl.DateTimeFormat 不划算）
let cached: string | undefined
function getSnapshot(): string {
  if (cached === undefined)
    cached = getBrowserTimeZone()
  return cached
}

/** 访问者浏览器的 IANA 时区；服务端渲染和水合阶段为空字符串，避免拿到服务器的时区 */
export function useBrowserTimeZone(): string {
  return useSyncExternalStore(subscribe, getSnapshot, () => '')
}
