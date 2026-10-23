'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WeatherCardProps } from './schema'
import type { WeatherCondition } from '@/models/weather'
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
import { useFormatter, useTranslations } from 'next-intl'
import { getWeather } from '@/api/weather'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCachedRequest } from '../use-cached-request'

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
  city: string
  condition: WeatherCondition
  temperature: number
  humidity: number
  wind: number
  isDay?: boolean
  footer?: ReactNode
}

function WeatherCardBody({ city, condition, temperature, humidity, wind, isDay = true, footer }: WeatherCardBodyProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const format = useFormatter()
  const { icon: Icon, gradient } = condition === 'clear' && !isDay ? CLEAR_NIGHT_STYLE : CONDITION_STYLES[condition]

  return (
    <div className={cn('overflow-hidden rounded-xl bg-linear-to-br p-5 text-white shadow-sm', gradient)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {city && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-white/85">
              <MapPinIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{city}</span>
            </div>
          )}
          <div className="mt-1.5 text-5xl font-semibold tracking-tight tabular-nums">
            {format.number(temperature, { maximumFractionDigits: 1 })}
            <span className="ml-0.5 align-top text-2xl font-medium">°C</span>
          </div>
          <div className="mt-1 font-medium">{t(`options.condition.${condition}`)}</div>
        </div>
        <Icon className="size-16 shrink-0 drop-shadow-md" strokeWidth={1.5} aria-hidden />
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
        {footer && <span className="ml-auto text-xs text-white/70">{footer}</span>}
      </div>
    </div>
  )
}

/** 实时模式：按保存的坐标请求后端代理接口（后端按坐标缓存），显示观测地的当前天气 */
function LiveWeatherCard({ city, latitude, longitude }: WeatherCardProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const format = useFormatter()
  const state = useCachedRequest(`weather:${latitude.toFixed(2)},${longitude.toFixed(2)}`, () => getWeather(latitude, longitude))

  if (state.status === 'loading') {
    return (
      <div className="grid gap-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-4 w-40" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <MapPinIcon className="size-4 shrink-0" aria-hidden />
        {city}
        <span className="ml-auto">{t('load_failed')}</span>
      </div>
    )
  }
  const { data } = state
  const observedAt = parseLocalDateTime(data.observedAt)
  return (
    <WeatherCardBody
      city={city}
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
