'use client'

import type { LucideIcon } from 'lucide-react'
import type { IslandActivity } from '@/contexts/topbar-island'
import type { Weather, WeatherCondition } from '@/models/weather'
import type { IslandSettings } from '@/utils/common/siteinfo'
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
  MoonIcon,
  MoonStarIcon,
  PartyPopperIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
  WifiIcon,
  WifiOffIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { getWeather, locateWeatherByIP } from '@/api/weather'
import { useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/contexts/theme-context'
import { pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { toServiceLanguage } from '@/locales/registry'
import { getThemeIcon } from '@/themes/icons'

// 离线压过一切：读者此时最需要知道的就是网络断了
const OFFLINE_PRIORITY = 100

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** 断网时常驻「已离线」，恢复后短暂提示「已重新连接」 */
export function NetworkIsland() {
  const t = useTranslations('TopbarIsland')
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const activity = useMemo<IslandActivity | null>(() => online
    ? null
    : {
        id: 'network',
        feature: 'network',
        priority: OFFLINE_PRIORITY,
        label: t('network_offline_label'),
        compact: (
          <>
            <WifiOffIcon aria-hidden className="size-4 shrink-0 text-amber-400" />
            <span className="truncate">{t('network_offline')}</span>
          </>
        ),
        minimal: <WifiOffIcon aria-hidden className="size-4 text-amber-400" />,
      }, [online, t])
  useIslandActivity(activity)

  const wasOfflineRef = useRef(false)
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true
      return
    }
    if (!wasOfflineRef.current)
      return
    wasOfflineRef.current = false
    pushIslandAlert({ key: 'network', feature: 'network', icon: <WifiIcon aria-hidden className="text-emerald-400" />, text: t('network_online') })
  }, [online, t])

  return null
}

// 页面加载后稍等再问候，避开首屏入场动画
const GREETING_DELAY_MS = 1500
const GREETING_MS = 4000
// 天气最多等这么久，超时就不带天气问候
const WEATHER_TIMEOUT_MS = 3000
// 问候每个浏览会话一次；节日每个节日每天一次
const GREETED_KEY = 'island-greeted'
const HOLIDAY_KEY = 'island-holiday'

type DayPart = 'late_night' | 'morning' | 'noon' | 'afternoon' | 'evening'

const DAY_PART_ICONS: Record<DayPart, LucideIcon> = {
  late_night: MoonStarIcon,
  morning: SunriseIcon,
  noon: SunIcon,
  afternoon: SunIcon,
  evening: SunsetIcon,
}

const WEATHER_ICONS: Record<WeatherCondition, LucideIcon> = {
  clear: SunIcon,
  partly_cloudy: CloudSunIcon,
  cloudy: CloudIcon,
  fog: CloudFogIcon,
  drizzle: CloudDrizzleIcon,
  rain: CloudRainIcon,
  sleet: CloudHailIcon,
  snow: CloudSnowIcon,
  thunderstorm: CloudLightningIcon,
}
// 夜间只区分晴与少云（同文章内的天气卡）
const NIGHT_WEATHER_ICONS: Partial<Record<WeatherCondition, LucideIcon>> = { clear: MoonIcon, partly_cloudy: CloudMoonIcon }

/** 按访客本地时间划分的时段 */
function dayPartOf(hour: number): DayPart {
  if (hour < 5 || hour >= 23)
    return 'late_night'
  if (hour < 11)
    return 'morning'
  if (hour < 13)
    return 'noon'
  if (hour < 18)
    return 'afternoon'
  return 'evening'
}

function readStorage(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key)
  }
  catch {
    return null
  }
}

function writeStorage(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value)
  }
  catch {
    // 隐私模式等写入失败时忽略，最多多问候一次
  }
}

/** 按访客 IP 粗略定位城市（城市级，不保存）后取当前天气；失败或超时为 null */
async function loadWeather(lang: string): Promise<Weather | null> {
  const timeout = new Promise<null>(resolve => window.setTimeout(resolve, WEATHER_TIMEOUT_MS, null))
  const request = locateWeatherByIP(lang)
    .then(place => getWeather(place.latitude, place.longitude))
    .catch(() => null)
  return Promise.race([request, timeout])
}

/**
 * 氛围彩蛋：节日主题生效的日子里，当天第一次进站提示「今天是某某节」（图标用节日主题的点赞图形）；
 * 否则每个浏览会话问候一次（按访客本地时间分时段，登录后带上昵称，后台开启时附带当地天气）
 */
export function AmbientIsland({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const themeT = useTranslations('ThemePack')
  const weatherT = useTranslations('ContentComponents.weatherCard')
  const locale = useLocale()
  const { user } = useAuth()
  const { theme, enabled: themeEnabled } = useTheme()
  const name = user?.nickname || user?.username || ''

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      // 节日：有日期规则的主题即节日 / 季节主题
      if (settings.holiday && themeEnabled && theme?.schedule) {
        const now = new Date()
        const mark = `${theme.id}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
        if (readStorage(() => localStorage, HOLIDAY_KEY) !== mark) {
          const HolidayIcon = getThemeIcon(theme.icons?.like) ?? PartyPopperIcon
          if (pushIslandAlert({ key: 'holiday', feature: 'holiday', icon: <HolidayIcon aria-hidden />, text: t('holiday', { name: themeT(`names.${theme.id}`) }), duration: GREETING_MS })) {
            writeStorage(() => localStorage, HOLIDAY_KEY, mark)
            // 节日提示过了，这次就不再问候
            writeStorage(() => sessionStorage, GREETED_KEY, '1')
            return
          }
        }
      }
      if (!settings.greeting || readStorage(() => sessionStorage, GREETED_KEY))
        return
      const part = dayPartOf(new Date().getHours())
      const greeting = name ? t('greeting_named', { greeting: t(`greeting_${part}`), name }) : t(`greeting_${part}`)
      const weather = settings.weather ? await loadWeather(toServiceLanguage(locale)) : null
      if (cancelled)
        return
      const Icon = weather
        ? (!weather.isDay && NIGHT_WEATHER_ICONS[weather.condition]) || WEATHER_ICONS[weather.condition]
        : DAY_PART_ICONS[part]
      const temperature = weather ? Math.round(weather.temperature) : 0
      const pushed = pushIslandAlert({
        key: 'greeting',
        feature: 'greeting',
        icon: <Icon aria-hidden className="text-amber-300" />,
        text: weather ? t('greeting_weather', { greeting, temperature }) : greeting,
        announce: weather ? t('greeting_weather_announce', { greeting, condition: weatherT(`options.condition.${weather.condition}`), temperature }) : greeting,
        duration: GREETING_MS,
      })
      if (pushed)
        writeStorage(() => sessionStorage, GREETED_KEY, '1')
    }, GREETING_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [locale, name, settings.greeting, settings.holiday, settings.weather, t, theme, themeEnabled, themeT, weatherT])

  return null
}
