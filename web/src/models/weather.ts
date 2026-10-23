// 天气状况：与后端 WeatherCondition 的映射结果一致
export const WEATHER_CONDITIONS = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunderstorm'] as const

export type WeatherCondition = typeof WEATHER_CONDITIONS[number]

// 当前天气（文章内的天气卡）
export interface Weather {
  condition: WeatherCondition
  temperature: number // 摄氏度
  humidity: number // 百分比
  windSpeed: number // km/h
  windLevel: number // 蒲福风级
  isDay: boolean
  observedAt: string // 观测地当地时间 YYYY-MM-DDTHH:mm
  timezone: string
  latitude: number
  longitude: number
}

// 城市搜索结果
export interface WeatherPlace {
  name: string
  admin1: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
}
