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

// 按访客 IP 粗略估计所在城市（城市级，不保存）；天气卡未指定城市时用它跟随访客所在地
export async function locateWeatherByIP(lang: string): Promise<WeatherPlace> {
  const res = await axiosClient.get<BaseResponse<WeatherPlace>>('/misc/weather/locate', { params: { lang } })
  return res.data.data
}

// 按坐标反查地名（市 / 区级）；lang 可带地区码（如 zh-tw），用于访客定位后显示位置名称
export async function reverseWeatherPlace(lat: number, lon: number, lang: string): Promise<WeatherPlace> {
  const res = await axiosClient.get<BaseResponse<WeatherPlace>>('/misc/weather/reverse', { params: { lat, lon, lang } })
  return res.data.data
}
