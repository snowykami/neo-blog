import { z } from 'zod'

// netease：博客歌单内的网易云歌曲（可站内播放）；custom：自定义音频（歌名、艺人与音频地址由作者填写）
export const LYRIC_QUOTE_SOURCES = ['netease', 'custom'] as const

// 各音源在属性弹窗中显示的字段
export const LYRIC_QUOTE_SOURCE_FIELDS: Record<typeof LYRIC_QUOTE_SOURCES[number], string[]> = {
  netease: ['source', 'id', 'lyric', 'showTranslation', 'translation', 'showRomaji', 'romaji', 'start', 'end', 'text'],
  custom: ['source', 'title', 'artist', 'src', 'lyric', 'showTranslation', 'translation', 'showRomaji', 'romaji', 'start', 'end', 'text'],
}

// 资源地址只允许 http(s) 或站内路径（如资产库的 /api/v1/file/...），不接受 javascript: 等其他协议
const assetUrl = z.string().trim().max(2000).refine(value => value === '' || /^(?:https?:\/\/|\/(?!\/))/i.test(value))

export const lyricQuoteSchema = z.object({
  source: z.enum(LYRIC_QUOTE_SOURCES).default('netease'),
  // 网易云歌曲 ID（歌曲链接中 id= 后的数字）
  id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  title: z.string().trim().max(120).default(''),
  artist: z.string().trim().max(120).default(''),
  src: assetUrl.meta({ widget: 'audio' }).default(''),
  // LRC / YRC 歌词，可选：网易云模式留空时按歌曲 ID 在线获取
  lyric: z.string().max(20000).meta({ widget: 'textarea' }).default(''),
  // 是否显示翻译：可选开关，默认关闭；开启后下方才显示翻译歌词字段
  showTranslation: z.boolean().default(false),
  translation: z.string().max(20000).meta({ widget: 'textarea' }).default(''),
  // 是否显示发音/罗马音：可选开关，默认关闭；开启后下方才显示发音歌词字段
  showRomaji: z.boolean().default(false),
  romaji: z.string().max(20000).meta({ widget: 'textarea' }).default(''),
  // 引用片段的起始歌词时间（毫秒），由「选择歌词」动作填入
  start: z.number().int().min(0).max(86_400_000).default(0),
  // 引用片段的结束歌词时间（毫秒），0 表示只引用起始句
  end: z.number().int().min(0).max(86_400_000).default(0),
  // 歌词文本快照：歌词接口不可用或作者手填时间时用于展示
  text: z.string().trim().max(2000).default(''),
}).superRefine((props, ctx) => {
  const required = (path: string) => ctx.addIssue({ code: 'custom', path: [path], params: { reason: 'required' }, message: 'required' })
  if (props.source === 'netease' && props.id <= 0)
    required('id')
  if (props.source === 'custom') {
    if (!props.title)
      required('title')
    if (!props.src)
      required('src')
  }
  if (props.end > 0 && props.end < props.start)
    ctx.addIssue({ code: 'custom', path: ['end'], params: { reason: 'range' }, message: 'range' })
})

export type LyricQuoteProps = z.output<typeof lyricQuoteSchema>
export type LyricQuoteInput = z.input<typeof lyricQuoteSchema>
