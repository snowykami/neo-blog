import type { WeatherCardProps } from './schema'
import type { WeatherCondition } from '@/models/weather'
import { CloudSunIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { WEATHER_MODE_FIELDS, weatherCardSchema } from './schema'

// 降级内容不依赖语言，天气状况用 emoji 表示
const CONDITION_EMOJI: Record<WeatherCondition, string> = {
  clear: '☀️',
  partly_cloudy: '⛅',
  cloudy: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  sleet: '🌨️',
  snow: '❄️',
  thunderstorm: '⛈️',
}

function weatherSummary({ mode, city, condition, temperature, humidity, wind, recordedAt }: WeatherCardProps): string {
  if (mode === 'live')
    return `🌡️ ${city}`
  const parts = [city, `${temperature}°C`, `💧 ${humidity}%`, `🍃 ${wind} Bft`, recordedAt.replace('T', ' ')]
  return `${CONDITION_EMOJI[condition]} ${parts.filter(Boolean).join(' · ')}`
}

export default defineContentComponent({
  name: 'weatherCard',
  version: 1,
  // 卡片内容紧凑，默认半宽
  defaultWidth: 50,
  // 1 单位：横排的温度与天气；2 单位：完整信息
  heights: [1, 2],
  schema: weatherCardSchema,
  component: dynamic(() => import('./weather-card')),
  icon: CloudSunIcon,
  keywords: ['weather', 'tianqi', 'tq', 'qiwen', '天气', '气温', '温度'],
  fallback: (props: WeatherCardProps) => [['p', {}, weatherSummary(props)]],
  example: t => ({ city: t('city'), condition: 'partly_cloudy' as const, temperature: 23, humidity: 58, wind: 3, recordedAt: '2026-10-23T14:30' }),
  editor: {
    // 「获取当前天气」：按城市或作者的位置获取天气后填入表单
    action: dynamic(() => import('./weather-card-action')),
    isFieldVisible: (name, { mode }) => WEATHER_MODE_FIELDS[mode ?? 'snapshot'].includes(name),
  },
})
