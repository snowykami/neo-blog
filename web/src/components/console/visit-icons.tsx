import type { IconType } from 'react-icons'
import { CornerDownRight, Globe, Monitor, MousePointerClick, Search, Smartphone, Tablet } from 'lucide-react'
import { FaAndroid, FaApple, FaChrome, FaEdge, FaFacebook, FaFirefoxBrowser, FaGithub, FaGoogle, FaLinkedin, FaLinux, FaMicrosoft, FaOpera, FaQq, FaReddit, FaSafari, FaTelegram, FaWeibo, FaWeixin, FaWindows, FaXTwitter, FaYahoo, FaYandex } from 'react-icons/fa6'
import { SiBaidu, SiBilibili, SiClaude, SiCsdn, SiDuckduckgo, SiHarmonyos, SiJuejin, SiOpenai, SiPerplexity, SiSamsung, SiSogou, SiZhihu } from 'react-icons/si'
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

// 访问来源：key 与后端 utils.ClassifyReferrer 的分类对应，名称为各平台的品牌名
export const SOURCE_NAMES: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  baidu: '百度',
  duckduckgo: 'DuckDuckGo',
  yandex: 'Yandex',
  yahoo: 'Yahoo',
  sogou: '搜狗',
  so360: '360 搜索',
  github: 'GitHub',
  twitter: 'X (Twitter)',
  weibo: '微博',
  zhihu: '知乎',
  bilibili: '哔哩哔哩',
  v2ex: 'V2EX',
  reddit: 'Reddit',
  telegram: 'Telegram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  juejin: '掘金',
  csdn: 'CSDN',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  claude: 'Claude',
}

const sourceIcons: Record<string, IconType> = {
  google: FaGoogle,
  bing: FaMicrosoft,
  baidu: SiBaidu,
  duckduckgo: SiDuckduckgo,
  yandex: FaYandex,
  yahoo: FaYahoo,
  sogou: SiSogou,
  github: FaGithub,
  twitter: FaXTwitter,
  weibo: FaWeibo,
  zhihu: SiZhihu,
  bilibili: SiBilibili,
  reddit: FaReddit,
  telegram: FaTelegram,
  facebook: FaFacebook,
  linkedin: FaLinkedin,
  juejin: SiJuejin,
  csdn: SiCsdn,
  chatgpt: SiOpenai,
  perplexity: SiPerplexity,
  claude: SiClaude,
}

export function SourceIcon({ source, className }: { source: string, className?: string }) {
  const Icon = sourceIcons[source]
  if (Icon)
    return <Icon className={className} aria-hidden="true" />
  const Fallback = source === 'direct' ? MousePointerClick : source === 'internal' ? CornerDownRight : source === 'so360' ? Search : Globe
  return <Fallback className={cn('size-4', className)} aria-hidden="true" />
}
