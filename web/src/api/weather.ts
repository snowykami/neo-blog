import type { BaseResponse } from '@/models/resp'
import type { Weather, WeatherPlace } from '@/models/weather'
import axiosClient from './client'

// 天气由后端代为请求 Open-Meteo 并按坐标缓存，只能按经纬度查询
export async function getWeather(lat: number, lon: number): Promise<Weather> {
  const res = await axiosClient.get<BaseResponse<Weather>>('/misc/weather', { params: { lat, lon } })
  return res.data.data
}

// 按名称搜索城市；lang 为两位语言代码，决定结果中的地名语言
export async function searchWeatherPlaces(q: string, lang: string): Promise<WeatherPlace[]> {
  const res = await axiosClient.get<BaseResponse<WeatherPlace[]>>('/misc/weather/geo', { params: { q, lang } })
  return res.data.data
}
