import type { VisitSignals } from '@/models/visit'
import { doNotTrack } from './fingerprint'

/**
 * 访问上报附带的浏览器信号：只读取无需授权、低熵的公开值，用于后端做一致性检测（识别代理、UA 伪装、自动化）
 * 开启“请勿追踪”或全局隐私控制时不采集
 */
export function collectVisitSignals(): VisitSignals | undefined {
  if (typeof window === 'undefined' || doNotTrack())
    return undefined
  const media = (query: string) => window.matchMedia?.(query).matches ?? false
  return {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffset: -new Date().getTimezoneOffset(),
    languages: [...(navigator.languages ?? [])].slice(0, 3),
    screen: `${window.screen.width}x${window.screen.height}`,
    dpr: Math.round(window.devicePixelRatio * 1000) / 1000,
    touchPoints: navigator.maxTouchPoints ?? 0,
    pointer: media('(pointer: coarse)') ? 'coarse' : 'fine',
    colorScheme: media('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    webdriver: navigator.webdriver === true,
  }
}
