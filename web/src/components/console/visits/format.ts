import type { VisitRuleResult, WebVitalName } from '@/models/visit'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useMemo } from 'react'
import { toServiceLanguage } from '@/locales/registry'

// 时区偏移（分钟，东正西负）显示为 UTC+8 / UTC−5 / UTC+5:30
export function formatOffset(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes))
    return '—'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `UTC${minutes >= 0 ? '+' : '−'}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

// 停留时长（毫秒）显示为 m:ss，超过一小时为 h:mm:ss
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// Web Vitals 评级阈值（good 上限 / poor 下限），与 web-vitals 库一致
const VITAL_THRESHOLDS: Record<WebVitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
}

export function vitalRating(name: WebVitalName, value: number): 'good' | 'needsImprovement' | 'poor' {
  const [good, poor] = VITAL_THRESHOLDS[name]
  return value <= good ? 'good' : value > poor ? 'poor' : 'needsImprovement'
}

// Web Vitals 数值：CLS 保留三位小数，其余毫秒，超过一秒显示为秒
export function formatVital(name: WebVitalName, value: number): string {
  if (name === 'CLS')
    return value.toFixed(3)
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
}

// IPv6 只显示 /64 网段前缀，如 2409:8760:1e81:10::/64；IPv4 原样返回
export function ipDisplay(ip: string): string {
  if (!ip.includes(':'))
    return ip
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = ip.includes('::') && tail ? tail.split(':') : []
  const groups = [...left, ...Array.from<string>({ length: Math.max(0, 8 - left.length - right.length) }).fill('0'), ...right]
  const prefix = groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '').toLowerCase())
  return `${prefix.join(':')}::/64`
}

// 港澳台在中文界面下使用的名称：简体（含 zh-SG）与繁体（zh-TW、zh-HK、zh-MO）
const ZH_REGION_NAMES: Record<string, Record<string, string>> = {
  'zh': { HK: '中国香港', MO: '中国澳门', TW: '中国台湾' },
  'zh-tw': { HK: '中國香港', MO: '中國澳門', TW: '中國台灣' },
}

// 国家代码 → 当前语言下的名称（Intl.DisplayNames），无法识别时返回代码本身
export function useCountryName() {
  const locale = useLocale()
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' })
    }
    catch {
      names = null
    }
    return (code: string) => {
      if (!code)
        return ''
      const zhName = ZH_REGION_NAMES[toServiceLanguage(locale)]?.[code]
      if (zhName)
        return zhName
      try {
        return names?.of(code) ?? code
      }
      catch {
        return code
      }
    }
  }, [locale])
}

// 规则说明文案：参数中的国家代码、时区偏移、设备类型等先转换为可读文字
// 请求层会把参数键转为 camelCase（如 ip_country → ipCountry），文案占位符与之一致
export function useRuleText() {
  const t = useTranslations('Console.visits.trust')
  const countryName = useCountryName()
  const { list } = useListFormat()
  return useCallback((rule: Pick<VisitRuleResult, 'reason' | 'params'>) => {
    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(rule.params ?? {})) {
      switch (key) {
        case 'country':
        case 'tzCountry':
        case 'ipCountry':
        case 'from':
        case 'to':
          values[key] = countryName(value)
          break
        case 'countries':
          values[key] = list(value.split(',').map(countryName))
          break
        case 'offset':
        case 'expected':
          values[key] = formatOffset(Number(value))
          break
        case 'ipOffsets': {
          const offsets = value ? value.split(',').map(Number) : []
          values[key] = offsets.length > 2
            ? `${formatOffset(offsets[0])} ~ ${formatOffset(offsets[offsets.length - 1])}`
            : offsets.map(formatOffset).join(' / ')
          break
        }
        case 'device':
          values[key] = t(`devices.${value === 'tablet' ? 'tablet' : 'mobile'}`)
          break
        case 'pointer':
          values[key] = t(`pointers.${value === 'coarse' ? 'coarse' : 'fine'}`)
          break
        default:
          values[key] = value
      }
    }
    return t(`reasons.${rule.reason}`, values)
  }, [t, countryName, list])
}

function useListFormat() {
  const locale = useLocale()
  return useMemo(() => {
    const formatter = new Intl.ListFormat([locale], { style: 'short', type: 'disjunction' })
    return { list: (items: string[]) => formatter.format(items) }
  }, [locale])
}
