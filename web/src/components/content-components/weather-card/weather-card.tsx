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
  CloudMoonIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  DropletsIcon,
  LocateFixedIcon,
  MapPinIcon,
  MoonIcon,
  RotateCwIcon,
  SunIcon,
  WindIcon,
} from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { getWeather, locateWeatherByIP, reverseWeatherPlace } from '@/api/weather'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCachedRequest } from '../use-cached-request'
import { useComponentHeight } from '../use-component-height'

// 各天气状况的图标与渐变背景：两端颜色都足够深，保证 90% 不透明度的白字对比度 ≥ 4.5:1（WCAG AA），
// 同时避免暗色模式下出现大块高亮的色块
const CONDITION_STYLES: Record<WeatherCondition, { icon: LucideIcon, gradient: string }> = {
  clear: { icon: SunIcon, gradient: 'from-sky-700 to-blue-700' },
  partly_cloudy: { icon: CloudSunIcon, gradient: 'from-sky-700 to-slate-600' },
  cloudy: { icon: CloudIcon, gradient: 'from-slate-600 to-slate-800' },
  fog: { icon: CloudFogIcon, gradient: 'from-zinc-600 to-slate-700' },
  drizzle: { icon: CloudDrizzleIcon, gradient: 'from-sky-700 to-slate-700' },
  rain: { icon: CloudRainIcon, gradient: 'from-slate-600 to-blue-900' },
  sleet: { icon: CloudHailIcon, gradient: 'from-slate-600 to-cyan-900' },
  snow: { icon: CloudSnowIcon, gradient: 'from-cyan-700 to-slate-600' },
  thunderstorm: { icon: CloudLightningIcon, gradient: 'from-slate-700 to-indigo-950' },
}
// 夜间只区分晴与少云，其余天气状况昼夜外观相同
const NIGHT_STYLES: Partial<Record<WeatherCondition, { icon: LucideIcon, gradient: string }>> = {
  clear: { icon: MoonIcon, gradient: 'from-indigo-800 to-slate-900' },
  partly_cloudy: { icon: CloudMoonIcon, gradient: 'from-indigo-800 to-slate-700' },
}

// 当地时间（YYYY-MM-DDTHH:mm）按 UTC 解析并按 UTC 格式化，保证显示的就是保存的钟面时间，不随读者时区变化
function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  return match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5])) : null
}

/** 快照没有昼夜信息：按记录时间的钟点估算（6:00 ~ 18:00 为白天），未填写时间时按白天处理 */
function isDaytime(recordedAt: Date | null): boolean {
  if (!recordedAt)
    return true
  const hour = recordedAt.getUTCHours()
  return hour >= 6 && hour < 18
}

// 底部说明：完整文案用于宽卡片，简短文案用于窄卡片与 2 单位的横排卡片，保证读者总能区分快照与实时
interface WeatherFooter {
  full: string
  short: string
  live?: boolean
}

interface WeatherCardBodyProps {
  // 城市名可为空：留空时显示「当前位置」（作者不想公开具体城市）
  city: string
  condition: WeatherCondition
  temperature: number
  humidity: number
  wind: number
  isDay?: boolean
  footer?: WeatherFooter | null
  // 地名后的操作（如「使用精确位置」）
  placeAction?: ReactNode
}

/** 底部说明文字；实时天气前加一个呼吸点 */
function FooterText({ footer, short }: { footer: WeatherFooter, short?: boolean }) {
  const text = short
    ? footer.short
    : (
        <>
          <span className="@max-2xs:hidden">{footer.full}</span>
          <span className="hidden @max-2xs:inline">{footer.short}</span>
        </>
      )
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/90">
      {footer.live && <span aria-hidden className="size-1.5 rounded-full bg-emerald-300 motion-safe:animate-pulse" />}
      {text}
    </span>
  )
}

/**
 * 天气卡主体：高度 2 单位（112px）时横排显示图标、温度、天气、位置与简短时间，收起湿度与风力；
 * 其余高度为完整布局（固定高度时底部信息贴底）；窄卡片收起次要信息
 */
function WeatherCardBody({ city, condition, temperature, humidity, wind, isDay = true, footer, placeAction }: WeatherCardBodyProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const format = useFormatter()
  const height = useComponentHeight()
  const { icon: Icon, gradient } = (!isDay && NIGHT_STYLES[condition]) || CONDITION_STYLES[condition]
  const temperatureText = format.number(temperature, { maximumFractionDigits: 1 })
  const placeText = city || t('current_location')
  const cardClass = cn('overflow-hidden rounded-xl bg-linear-to-br text-white shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10 dark:ring-inset', gradient)

  if (height === 2) {
    return (
      <div className={cn(cardClass, 'flex h-full items-center gap-3 px-4')}>
        <Icon className="size-12 shrink-0 drop-shadow-md @max-3xs:hidden" strokeWidth={1.5} aria-hidden />
        <div className="shrink-0 text-4xl font-semibold tracking-tight tabular-nums">
          {temperatureText}
          <span className="ml-0.5 align-top text-lg font-medium">°C</span>
        </div>
        <div className="ml-auto grid min-w-0 justify-items-end gap-0.5 text-right">
          <span className="font-medium">{t(`options.condition.${condition}`)}</span>
          <span className="flex max-w-full items-center gap-1 text-sm text-white/90">
            <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{placeText}</span>
            {placeAction}
          </span>
          {footer && <FooterText footer={footer} short />}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(cardClass, 'flex h-full flex-col justify-between p-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-white/90">
            <MapPinIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{placeText}</span>
            {placeAction}
          </div>
          <div className="mt-1.5 text-5xl font-semibold tracking-tight tabular-nums">
            {temperatureText}
            <span className="ml-0.5 align-top text-2xl font-medium">°C</span>
          </div>
          <div className="mt-1 font-medium">{t(`options.condition.${condition}`)}</div>
        </div>
        <Icon className="size-16 shrink-0 drop-shadow-md @max-3xs:hidden" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90">
        <span className="inline-flex items-center gap-1.5">
          <DropletsIcon className="size-4" aria-hidden />
          {t('humidity', { value: humidity })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <WindIcon className="size-4" aria-hidden />
          {t('wind_level', { level: wind })}
        </span>
        {footer && <span className="ml-auto"><FooterText footer={footer} /></span>}
      </div>
    </div>
  )
}

/** 加载中：与天气卡同样的形状与高度，避免加载完成后跳动 */
function WeatherCardSkeleton() {
  const height = useComponentHeight()
  const bar = 'bg-white/25 dark:bg-white/10'
  return (
    <div
      aria-busy
      className={cn(
        'overflow-hidden rounded-xl bg-linear-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-800',
        height == null ? 'min-h-45' : 'h-full',
        height === 2 ? 'flex items-center gap-3 px-4' : 'grid content-between p-5',
      )}
    >
      {height === 2
        ? (
            <>
              <Skeleton className={cn('size-12 rounded-full', bar)} />
              <Skeleton className={cn('h-9 w-20', bar)} />
              <Skeleton className={cn('ml-auto h-4 w-16', bar)} />
            </>
          )
        : (
            <>
              <div className="grid gap-2.5">
                <Skeleton className={cn('h-4 w-20', bar)} />
                <Skeleton className={cn('h-11 w-28', bar)} />
                <Skeleton className={cn('h-4 w-12', bar)} />
              </div>
              <Skeleton className={cn('h-4 w-40', bar)} />
            </>
          )}
    </div>
  )
}

/** 实时模式的数据：跟随访客所在地时把解析出的城市名一并返回，供卡片显示；precise 表示使用了浏览器精确定位 */
interface LiveWeatherData {
  weather: Weather
  city: string
  precise: boolean
}

// 访客拒绝过定位后记下来，不再提供「使用精确位置」
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

/** 浏览器是否可以请求精确定位：需要 HTTPS、支持定位且访客没有拒绝过 */
function canRequestPreciseLocation(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation && window.isSecureContext && !geolocationDenied()
}

/** 访客是否已授权定位（已授权时直接使用精确定位，不会弹出权限框；Safari 不支持查询，按未授权处理） */
async function geolocationGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state === 'denied')
      rememberGeolocationDenied()
    return status.state === 'granted'
  }
  catch {
    return false
  }
}

/** 取访客的精确定位；超时、不可用或被拒绝时返回 null。只返回坐标，地名由调用方按坐标反查 */
async function requestPreciseLocation(timeout = 8000): Promise<{ latitude: number, longitude: number } | null> {
  if (!canRequestPreciseLocation())
    return null
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
 * 两者都留空时跟随访客所在地 —— 默认按 IP 粗略定位，不在打开文章时弹出定位权限框；
 * 访客已授权定位时直接使用精确定位，否则可点击地名旁的按钮改用精确定位
 */
function LiveWeatherCard({ city, latitude, longitude }: WeatherCardProps) {
  const t = useTranslations('ContentComponents.weatherCard')
  const locale = useLocale()
  const format = useFormatter()
  const fixed = latitude !== 0 || longitude !== 0
  // 是否使用精确定位：跟随访客所在地时先查询定位权限（null 表示尚未查询），避免先按 IP 请求一次再按精确位置请求一次
  const [precise, setPrecise] = useState<boolean | null>(fixed ? false : null)
  // 加载失败后点击重试：换一个缓存键重新请求（失败的请求不会被缓存）
  const [attempt, setAttempt] = useState(0)
  // 地名语言取界面语言的两位代码（zh-tw 同样取 zh）
  const lang = locale.slice(0, 2)

  useEffect(() => {
    if (fixed)
      return
    let cancelled = false
    void geolocationGranted().then(granted => !cancelled && setPrecise(current => current ?? granted))
    return () => {
      cancelled = true
    }
  }, [fixed])

  const baseKey = fixed
    ? `weather:${latitude.toFixed(2)},${longitude.toFixed(2)}`
    : precise == null ? null : `weather:visitor:${precise ? 'precise' : 'ip'}:${lang}`
  const state = useCachedRequest<LiveWeatherData>(
    baseKey && attempt > 0 ? `${baseKey}#${attempt}` : baseKey,
    async () => {
      if (fixed)
        return { weather: await getWeather(latitude, longitude), city, precise: false }
      const position = precise ? await requestPreciseLocation() : null
      if (position) {
        const rounded = { latitude: roundCoordinate(position.latitude), longitude: roundCoordinate(position.longitude) }
        const [place, weather] = await Promise.all([
          // 地名只用于显示，反查失败时退回「当前位置」
          reverseWeatherPlace(rounded.latitude, rounded.longitude, locale).catch(() => null),
          getWeather(rounded.latitude, rounded.longitude),
        ])
        return { weather, city: place ? [place.admin1, place.name].filter(Boolean).join(' · ') : '', precise: true }
      }
      const place = await locateWeatherByIP(lang)
      return { weather: await getWeather(place.latitude, place.longitude), city: place.name, precise: false }
    },
  )

  if (state.status === 'loading')
    return <WeatherCardSkeleton />
  const switchToPreciseLocation = () => {
    // 再次点击（上次定位超时等）时同样重新请求
    setPrecise(true)
    setAttempt(value => value + 1)
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-full min-h-16 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-card px-5 py-3 text-sm text-muted-foreground">
        <MapPinIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{city || t('current_location')}</span>
        <span className="ml-auto shrink-0">{t('load_failed')}</span>
        {/* 按 IP 无法定位时（内网、代理等），让读者改用浏览器精确定位 */}
        {!fixed && !precise && canRequestPreciseLocation() && (
          <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={switchToPreciseLocation}>
            <LocateFixedIcon />
            {t('use_precise_location')}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setAttempt(value => value + 1)}>
          <RotateCwIcon />
          {t('retry')}
        </Button>
      </div>
    )
  }
  const { weather: data } = state.data
  // 跟随访客所在地时，用后端解析出的城市名替换作者留空的占位文案
  const cityText = state.data.city || city
  const observedAt = parseLocalDateTime(data.observedAt)
  const showPreciseAction = !fixed && !state.data.precise && canRequestPreciseLocation()
  return (
    <WeatherCardBody
      city={cityText}
      condition={data.condition}
      temperature={data.temperature}
      humidity={data.humidity}
      wind={data.windLevel}
      isDay={data.isDay}
      footer={{
        full: observedAt ? t('live_at', { time: format.dateTime(observedAt, { timeStyle: 'short', timeZone: 'UTC' }) }) : t('live'),
        short: t('live_short'),
        live: true,
      }}
      placeAction={showPreciseAction && (
        <button
          type="button"
          className="-my-0.5 shrink-0 rounded-full p-0.5 text-white/90 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          aria-label={t('use_precise_location')}
          title={t('use_precise_location')}
          onClick={switchToPreciseLocation}
        >
          <LocateFixedIcon className="size-3.5" aria-hidden />
        </button>
      )}
    />
  )
}

/** 天气卡：快照模式展示正文中保存的天气，不请求接口；实时模式展示指定城市（或访客所在地）的当前天气 */
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
      isDay={isDaytime(recordedAt)}
      footer={recordedAt && {
        full: t('recorded_at', { time: format.dateTime(recordedAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) }),
        short: format.dateTime(recordedAt, { dateStyle: 'short', timeZone: 'UTC' }),
      }}
    />
  )
}
