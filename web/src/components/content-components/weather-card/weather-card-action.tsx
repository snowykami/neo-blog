'use client'

import type { ContentEditorActionProps } from '../types'
import type { WeatherCardInput } from './schema'
import type { Weather, WeatherPlace } from '@/models/weather'
import { MapPinIcon, SearchIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { getWeather, searchWeatherPlaces } from '@/api/weather'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

// 坐标保留两位小数（约 1 km），与后端缓存粒度一致，也避免保存过于精确的位置
const roundCoordinate = (value: number) => Math.round(value * 100) / 100

type Status = { type: 'idle' } | { type: 'busy', action: 'search' | 'fetch' } | { type: 'message', key: string, error?: boolean }

/**
 * 天气卡的「获取当前天气」：搜索并选择城市。
 * 实时模式只写入城市与坐标（留空则卡片跟随访客所在地），快照模式顺便取一次天气填表
 */
export default function WeatherCardAction({ values, setValues }: ContentEditorActionProps<WeatherCardInput>) {
  const t = useTranslations('ContentComponents.weatherCard.action')
  const locale = useLocale()
  const live = values.mode === 'live'
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<WeatherPlace[] | null>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const busy = status.type === 'busy'

  const applyWeather = (weather: Weather, city?: string) => {
    setValues({
      ...(city != null && { city }),
      condition: weather.condition,
      temperature: weather.temperature,
      humidity: weather.humidity,
      wind: weather.windLevel,
      recordedAt: weather.observedAt,
    })
  }

  const search = async () => {
    const q = query.trim()
    if (!q || busy)
      return
    setStatus({ type: 'busy', action: 'search' })
    try {
      // 地名语言取界面语言的两位代码（zh-tw 同样取 zh）
      const result = await searchWeatherPlaces(q, locale.slice(0, 2))
      setPlaces(result)
      setStatus(result.length ? { type: 'idle' } : { type: 'message', key: 'no_results' })
    }
    catch {
      setStatus({ type: 'message', key: 'failed', error: true })
    }
  }

  const selectPlace = async (place: WeatherPlace) => {
    if (live) {
      setValues({ city: place.name, latitude: roundCoordinate(place.latitude), longitude: roundCoordinate(place.longitude) })
      setPlaces(null)
      setStatus({ type: 'message', key: 'place_selected' })
      return
    }
    setStatus({ type: 'busy', action: 'fetch' })
    try {
      applyWeather(await getWeather(roundCoordinate(place.latitude), roundCoordinate(place.longitude)), place.name)
      setPlaces(null)
      setStatus({ type: 'message', key: 'filled' })
    }
    catch {
      setStatus({ type: 'message', key: 'failed', error: true })
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">{live ? t('title_live') : t('title_snapshot')}</span>
        <span className="text-xs text-muted-foreground">{live ? t('hint_live') : t('hint_snapshot')}</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          maxLength={60}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 回车搜索，不提交属性表单
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={busy || !query.trim()} onClick={() => void search()}>
          {status.type === 'busy' && status.action === 'search' ? <Spinner /> : <SearchIcon />}
          {t('search')}
        </Button>
      </div>
      {places && places.length > 0 && (
        <div className="grid max-h-48 gap-1 overflow-y-auto">
          {places.map(place => (
            <Button
              key={`${place.latitude},${place.longitude}`}
              type="button"
              variant="ghost"
              className="h-auto justify-start gap-2 px-2 py-1.5 text-left font-normal"
              disabled={busy}
              onClick={() => void selectPlace(place)}
            >
              <MapPinIcon className="text-muted-foreground" />
              <span className="min-w-0 truncate">
                <span className="font-medium">{place.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{[place.admin1, place.country].filter(Boolean).join(', ')}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
      {status.type === 'busy' && status.action === 'fetch' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          {t('fetching')}
        </p>
      )}
      {status.type === 'message' && (
        <p className={status.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{t(status.key)}</p>
      )}
    </div>
  )
}
