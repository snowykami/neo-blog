import { z } from 'zod'

// netease：网易云歌曲（按 ID 读取信息，博客歌单内的可在站内播放）；custom：自定义音频（封面、歌名、艺人与音频地址由作者填写）
export const MUSIC_CARD_MODES = ['netease', 'custom'] as const

// 各模式在属性弹窗中显示的字段
export const MUSIC_CARD_MODE_FIELDS: Record<typeof MUSIC_CARD_MODES[number], string[]> = {
  netease: ['mode', 'id'],
  custom: ['mode', 'title', 'artist', 'album', 'cover', 'src', 'lyric'],
}

// 资源地址只允许 http(s) 或站内路径（如资产库的 /api/v1/file/...），不接受 javascript: 等其他协议
const assetUrl = z.string().trim().max(2000).refine(value => value === '' || /^(?:https?:\/\/|\/(?!\/))/i.test(value))

// 组件名保持 neteaseSong 以兼容已插入的卡片；旧数据只有 id，按网易云模式处理
export const neteaseSongSchema = z.object({
  mode: z.enum(MUSIC_CARD_MODES).default('netease'),
  // 网易云歌曲 ID（歌曲链接中 id= 后的数字）
  id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  title: z.string().trim().max(120).default(''),
  artist: z.string().trim().max(120).default(''),
  album: z.string().trim().max(120).default(''),
  cover: assetUrl.meta({ widget: 'image' }).default(''),
  src: assetUrl.meta({ widget: 'audio' }).default(''),
  // LRC 歌词，可选
  lyric: z.string().max(20000).meta({ widget: 'textarea' }).default(''),
}).superRefine((props, ctx) => {
  const required = (path: string) => ctx.addIssue({ code: 'custom', path: [path], params: { reason: 'required' }, message: 'required' })
  if (props.mode === 'netease' && props.id <= 0)
    required('id')
  if (props.mode === 'custom') {
    if (!props.title)
      required('title')
    if (!props.src)
      required('src')
  }
})

export type NeteaseSongProps = z.output<typeof neteaseSongSchema>
export type NeteaseSongInput = z.input<typeof neteaseSongSchema>
