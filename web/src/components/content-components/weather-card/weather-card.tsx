'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WeatherCardProps } from './schema'
import type { Weather, WeatherCondition } from '@/models/weather'
import {
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudHailIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  DropletsIcon,
  MapPinIcon,
  MoonIcon,
  SunIcon,
  WindIcon,
} from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { getWeather, locateWeatherByIP, reverseWeatherPlace } from '@/api/weather'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCachedRequest } from '../use-cached-request'
import { useComponentHeight } from '../use-component-height'

// 各天气状况的图标与渐变背景；晴天夜间单独处理
const CONDITION_STYLES: Record<WeatherCondition, { icon: LucideIcon, gradient: string }> = {
  clear: { icon: SunIcon, gradient: 'from-sky-400 to-blue-600' },
  partly_cloudy: { icon: CloudSunIcon, gradient: 'from-sky-400 to-slate-500' },
  cloudy: { icon: CloudIcon, gradient: 'from-slate-400 to-slate-600' },
  fog: { icon: CloudFogIcon, gradient: 'from-zinc-400 to-slate-600' },
  drizzle: { icon: CloudDrizzleIcon, gradient: 'from-sky-500 to-slate-600' },
  rain: { icon: CloudRainIcon, gradient: 'from-slate-500 to-blue-800' },
  sleet: { icon: CloudHailIcon, gradient: 'from-slate-400 to-cyan-800' },
  snow: { icon: CloudSnowIcon, gradient: 'from-sky-300 to-slate-500' },
  thunderstorm: { icon: CloudLightningIcon, gradient: 'from-slate-700 to-indigo-950' },
}
const CLEAR_NIGHT_STYLE = { icon: MoonIcon, gradient: 'from-indigo-800 to-slate-900' }

// 当地时间（YYYY-MM-DDTHH:mm）按 UTC 解析并按 UTC 格式化，保证显示的就是保存的钟面时间，不随读者时区变化
function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5])) : null
}

interface WeatherCardBodyProps {
  // 城市名可为空：留空时显示「当前位置」（作者不想公开具体城市）
  city: string
  condition: WeatherCondition
  temperature: number
  humidity: number
  wind: number
  isDay?: boolean
  footer?: ReactNode
}

/**
 * 天气卡主体：高度 2 单位（112px）时横排显示图标、温度、天气与位置，收起湿度、风力与时间；
 * 其余高度为完整布局（固定高度时底部信息贴底）；窄卡片收起次要信息
 */
function WeatherCardBody({ city, condition, temperature, humidity, wind, isDay = true, footer }: WeatherCardBodyProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const format = useFormatter()
  const height = useComponentHeight()
  const { icon: Icon, gradient } = condition === 'clear' && !isDay ? CLEAR_NIGHT_STYLE : CONDITION_STYLES[condition]
  const temperatureText = format.number(temperature, { maximumFractionDigits: 1 })
  const placeText = city || t('current_location')

  if (height === 2) {
    return (
      <div className={cn('flex h-full items-center gap-3 overflow-hidden rounded-xl bg-linear-to-br px-4 text-white shadow-sm', gradient)}>
        <Icon className="size-12 shrink-0 drop-shadow-md @max-3xs:hidden" strokeWidth={1.5} aria-hidden />
        <div className="shrink-0 text-4xl font-semibold tracking-tight tabular-nums">
          {temperatureText}
          <span className="ml-0.5 align-top text-lg font-medium">°C</span>
        </div>
        <div className="ml-auto grid min-w-0 justify-items-end gap-0.5 text-right">
          <span className="font-medium">{t(`options.condition.${condition}`)}</span>
          <span className="flex max-w-full items-center gap-1 text-sm text-white/85">
            <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{placeText}</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full flex-col justify-between overflow-hidden rounded-xl bg-linear-to-br p-5 text-white shadow-sm', gradient)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-white/85">
            <MapPinIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{placeText}</span>
          </div>
          <div className="mt-1.5 text-5xl font-semibold tracking-tight tabular-nums">
            {temperatureText}
            <span className="ml-0.5 align-top text-2xl font-medium">°C</span>
          </div>
          <div className="mt-1 font-medium">{t(`options.condition.${condition}`)}</div>
        </div>
        <Icon className="size-16 shrink-0 drop-shadow-md @max-3xs:hidden" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
        <span className="inline-flex items-center gap-1.5">
          <DropletsIcon className="size-4" aria-hidden />
          {t('humidity', { value: humidity })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <WindIcon className="size-4" aria-hidden />
          {t('wind_level', { level: wind })}
        </span>
        {footer && <span className="ml-auto text-xs text-white/70 @max-2xs:hidden">{footer}</span>}
      </div>
    </div>
  )
}

/** 实时模式的数据：跟随访客所在地时把解析出的城市名一并返回，供卡片显示 */
interface LiveWeatherData {
  weather: Weather
  city: string
}

// 访客拒绝过定位后记下来，避免每次打开文章都再弹一次权限框
const GEOLOCATION_DENIED_KEY = 'neo-blog:weather-geolocation-denied'

function geolocationDenied(): boolean {
  try {
    return localStorage.getItem(GEOLOCATION_DENIED_KEY) === '1'
  }
  catch {
    // 隐私模式等场景下 localStorage 不可用，当作未拒绝
    return false
  }
}

function rememberGeolocationDenied() {
  try {
    localStorage.setItem(GEOLOCATION_DENIED_KEY, '1')
  }
  catch {}
}

/**
 * 取访客的精确定位（需浏览器授权）；非 HTTPS、不支持、超时或被拒绝时返回 null，由 IP 定位兜底。
 * 只返回坐标，地名由调用方按坐标反查
 */
async function requestPreciseLocation(timeout = 8000): Promise<{ latitude: number, longitude: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation || !window.isSecureContext || geolocationDenied())
    return null
  // 已明确拒绝时不再弹框（Safari 不支持查询 geolocation 权限，忽略即可）
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state === 'denied') {
      rememberGeolocationDenied()
      return null
    }
  }
  catch {}
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (error) => {
        // 1 = PERMISSION_DENIED，其余（超时 / 位置不可用）下次仍可再试
        if (error.code === 1)
          rememberGeolocationDenied()
        resolve(null)
      },
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 },
    )
  })
}

// 与后端缓存粒度一致（0.01° ≈ 1 km），避免把更精确的位置发给服务端
const roundCoordinate = (value: number) => Math.round(value * 100) / 100

/**
 * 实时模式：作者指定了城市（及其坐标）时显示该城市的天气；
 * 两者都留空时跟随访客所在地 —— 先请求浏览器精确定位，访客拒绝或不可用时按 IP 粗略定位
 */
function LiveWeatherCard({ city, latitude, longitude }: WeatherCardProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const locale = useLocale()
  const format = useFormatter()
  const height = useComponentHeight()
  const fixed = latitude !== 0 || longitude !== 0
  // 地名语言取界面语言的两位代码（zh-tw 同样取 zh）
  const lang = locale.slice(0, 2)
  const state = useCachedRequest<LiveWeatherData>(
    fixed ? `weather:${latitude.toFixed(2)},${longitude.toFixed(2)}` : `weather:visitor:${lang}`,
    async () => {
      if (fixed)
        return { weather: await getWeather(latitude, longitude), city }
      const position = await requestPreciseLocation()
      if (position) {
        const precise = { latitude: roundCoordinate(position.latitude), longitude: roundCoordinate(position.longitude) }
        const [place, weather] = await Promise.all([
          // 地名只用于显示，反查失败时退回「当前位置」
          reverseWeatherPlace(precise.latitude, precise.longitude, locale).catch(() => null),
          getWeather(precise.latitude, precise.longitude),
        ])
        return { weather, city: place ? [place.admin1, place.name].filter(Boolean).join(' · ') : '' }
      }
      const place = await locateWeatherByIP(lang)
      return { weather: await getWeather(place.latitude, place.longitude), city: place.name }
    },
  )

  if (state.status === 'loading') {
    return (
      <div className="grid h-full content-center gap-3 overflow-hidden rounded-xl border bg-card px-5 py-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-28" />
        {height !== 2 && <Skeleton className="h-4 w-40" />}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-full items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <MapPinIcon className="size-4 shrink-0" aria-hidden />
        {city || t('current_location')}
        <span className="ml-auto">{t('load_failed')}</span>
      </div>
    )
  }
  const { weather: data } = state.data
  // 跟随访客所在地时，用后端解析出的城市名替换作者留空的占位文案
  const cityText = state.data.city || city
  const observedAt = parseLocalDateTime(data.observedAt)
  return (
    <WeatherCardBody
      city={cityText}
      condition={data.condition}
      temperature={data.temperature}
      humidity={data.humidity}
      wind={data.windLevel}
      isDay={data.isDay}
      footer={observedAt ? t('live_at', { time: format.dateTime(observedAt, { timeStyle: 'short', timeZone: 'UTC' }) }) : t('live')}
    />
  )
}

/** 天气卡：快照模式展示正文中保存的天气，不请求接口；实时模式展示指定城市的当前天气 */
export default function WeatherCard(props: WeatherCardProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const format = useFormatter()
  if (props.mode === 'live')
    return <LiveWeatherCard {...props} />

  const recordedAt = parseLocalDateTime(props.recordedAt)
  return (
    <WeatherCardBody
      city={props.city}
      condition={props.condition}
      temperature={props.temperature}
      humidity={props.humidity}
      wind={props.wind}
      footer={recordedAt && t('recorded_at', { time: format.dateTime(recordedAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) })}
    />
  )
}
