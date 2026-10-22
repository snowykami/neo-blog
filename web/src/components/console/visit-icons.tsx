import type { IconType } from 'react-icons'
import { CornerDownRight, Globe, Monitor, MousePointerClick, Search, Shuffle, Smartphone, Tablet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { FaAndroid, FaApple, FaChrome, FaEdge, FaFacebook, FaFirefoxBrowser, FaGithub, FaGoogle, FaLinkedin, FaLinux, FaMicrosoft, FaOpera, FaQq, FaReddit, FaSafari, FaTelegram, FaWeibo, FaWeixin, FaWindows, FaXTwitter, FaYahoo, FaYandex } from 'react-icons/fa6'
import { RiOpenaiFill } from 'react-icons/ri'
import { SiBaidu, SiBilibili, SiClaude, SiCsdn, SiDuckduckgo, SiHarmonyos, SiJuejin, SiPerplexity, SiSamsung, SiSogou, SiZhihu } from 'react-icons/si'
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
  chatgpt: RiOpenaiFill,
  perplexity: SiPerplexity,
  claude: SiClaude,
}

// 没有品牌图标的来源分类
const fallbackSourceIcons: Record<string, typeof Globe> = {
  direct: MousePointerClick,
  internal: CornerDownRight,
  random: Shuffle,
  so360: Search,
}

export function SourceIcon({ source, className }: { source: string, className?: string }) {
  const Icon = sourceIcons[source]
  if (Icon)
    return <Icon className={className} aria-hidden="true" />
  const Fallback = fallbackSourceIcons[source] ?? Globe
  return <Fallback className={cn('size-4', className)} aria-hidden="true" />
}

// 来源名称：常见平台显示品牌名，其他网站显示域名
export function SourceName({ source, host }: { source: string, host: string }) {
  const t = useTranslations('Console.visits')
  if (source === 'direct')
    return <>{t('source_direct')}</>
  if (source === 'internal')
    return <>{t('source_internal')}</>
  if (source === 'random')
    return <>{t('source_random')}</>
  if (source === 'external')
    return <>{host || t('source_external')}</>
  return <>{SOURCE_NAMES[source] ?? source}</>
}
