import type { IconType } from 'react-icons'
import { Globe, Monitor, Smartphone, Tablet } from 'lucide-react'
import { FaAndroid, FaApple, FaChrome, FaEdge, FaFirefoxBrowser, FaLinux, FaOpera, FaQq, FaSafari, FaWeixin, FaWindows } from 'react-icons/fa6'
import { SiHarmonyos, SiSamsung } from 'react-icons/si'
import { cn } from '@/lib/utils'

// 系统名与后端 utils.ParseUA 的返回值对应
const osIcons: Record<string, IconType> = {
  iOS: FaApple,
  iPadOS: FaApple,
  macOS: FaApple,
  Android: FaAndroid,
  Windows: FaWindows,
  Linux: FaLinux,
  ChromeOS: FaChrome,
  HarmonyOS: SiHarmonyos,
}

const browserIcons: Record<string, IconType> = {
  'Chrome': FaChrome,
  'Edge': FaEdge,
  'Firefox': FaFirefoxBrowser,
  'Safari': FaSafari,
  'Opera': FaOpera,
  'WeChat': FaWeixin,
  'QQ Browser': FaQq,
  'Samsung Internet': SiSamsung,
}

// 设备系统图标：识别不到系统时按设备类型显示通用图标
export function OsIcon({ os, deviceType, className }: { os: string, deviceType?: string, className?: string }) {
  const Icon = osIcons[os]
  if (Icon)
    return <Icon className={className} aria-label={os} />
  const Fallback = deviceType === 'mobile' ? Smartphone : deviceType === 'tablet' ? Tablet : Monitor
  return <Fallback className={cn('size-4', className)} aria-hidden="true" />
}

export function BrowserIcon({ browser, className }: { browser: string, className?: string }) {
  const Icon = browserIcons[browser]
  if (Icon)
    return <Icon className={className} aria-label={browser} />
  return <Globe className={cn('size-4', className)} aria-hidden="true" />
}
