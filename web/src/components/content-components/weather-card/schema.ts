import { z } from 'zod'
import { WEATHER_CONDITIONS } from '@/models/weather'

// snapshot：记录写作时的天气，数据固定在正文中；live：读者打开时按保存的坐标请求当前天气
export const WEATHER_MODES = ['snapshot', 'live'] as const

// 记录时间：datetime-local 格式的当地时间（不含时区），按原样展示
export const RECORDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/

// 各模式在属性弹窗中显示的字段
export const WEATHER_MODE_FIELDS: Record<typeof WEATHER_MODES[number], readonly string[]> = {
  snapshot: ['mode', 'city', 'condition', 'temperature', 'humidity', 'wind', 'recordedAt'],
  live: ['mode', 'city', 'latitude', 'longitude'],
}

export const weatherCardSchema = z.object({
  mode: z.enum(WEATHER_MODES).default('snapshot'),
  city: z.string().trim().max(60).default(''),
  condition: z.enum(WEATHER_CONDITIONS).default('clear'),
  // 摄氏度
  temperature: z.number().min(-90).max(60).default(20),
  // 相对湿度，百分比
  humidity: z.number().int().min(0).max(100).default(50),
  // 蒲福风级
  wind: z.number().int().min(0).max(12).default(2),
  recordedAt: z.string().trim().refine(value => value === '' || RECORDED_AT_PATTERN.test(value)).meta({ widget: 'datetime' }).default(''),
  latitude: z.number().min(-90).max(90).default(0),
  longitude: z.number().min(-180).max(180).default(0),
}).superRefine((props, ctx) => {
  // 实时模式需要城市名与坐标（0, 0 视为未填写）
  if (props.mode !== 'live')
    return
  if (!props.city)
    ctx.addIssue({ code: 'too_small', origin: 'string', minimum: 1, inclusive: true, path: ['city'], input: props.city })
  if (props.latitude === 0 && props.longitude === 0)
    ctx.addIssue({ code: 'custom', path: ['latitude'], input: props.latitude })
})

export type WeatherCardProps = z.output<typeof weatherCardSchema>
export type WeatherCardInput = z.input<typeof weatherCardSchema>
