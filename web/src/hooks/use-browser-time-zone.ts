import { useSyncExternalStore } from 'react'
import { getBrowserTimeZone } from '@/utils/common/time-zone'

const subscribe = () => () => {}

/** 访问者浏览器的 IANA 时区；服务端渲染和水合阶段为空字符串，避免拿到服务器的时区 */
export function useBrowserTimeZone(): string {
  return useSyncExternalStore(subscribe, getBrowserTimeZone, () => '')
}
