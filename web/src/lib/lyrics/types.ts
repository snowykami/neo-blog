/**
 * 播放器页歌词引擎的数据模型（见 docs/music-player-spec.md 7.3）；时间单位均为毫秒。
 * 逐词音译、注音等 TTML 特有字段在第三期加入
 */

export interface LyricRuby {
  text: string
  start: number
  end: number
}

export interface LyricWord {
  text: string
  start: number
  end: number
  // 日文汉字上方的逐字振假名注音（见 spec 8.5）
  ruby?: LyricRuby[]
}

/** 歌词行对齐方向：主唱左对齐、合唱居中、对唱右对齐 */
export type LyricAlign = 'left' | 'center' | 'right'

/** 演唱者身份元信息（TTML agent 与 AI 标注合并后的展示信息） */
export interface LyricAgent {
  id: string
  // 显示名称：TTML <ttm:name> 优先，否则回退 AI 标注推断名；未提供时为 undefined
  name?: string
  // 分配的 32 色主题色名（用于边缘光丝、切换胶囊圆点、舞台方向性洗光与默认行级微光）
  color: LyricColor
  // TTML 原生 ttv:color 自定义十六进制色（#rrggbb）；存在时优先用于边缘光丝、切换胶囊圆点与默认行级微光
  colorHex?: string
  // true 表示合唱/群组 agent
  isGroup?: boolean
  // 群组由多个个人 agent 并列构成时记录成员 ID，供双色光丝与双色圆点使用
  members?: string[]
}

export type LyricLang = 'zh' | 'zh-tw' | 'zh-hk' | 'en' | 'ja' | 'ko' | 'other'

export interface LyricLine {
  words: LyricWord[]
  // 行的开始时间：经过预处理的「提前起唱」后可能早于第一个词，用于高亮与滚动
  start: number
  end: number
  translation?: string
  translationLang?: LyricLang
  translationsByLang?: Partial<Record<LyricLang, string>>
  romanization?: string
  // 逐字音译（与原文的音节对齐，显示在原文下方并随演唱擦除）；对不齐时为空，只显示整行音译
  romanizationWords?: LyricRomanWord[]
  // 对唱：右对齐显示
  isDuet: boolean
  // 背景人声：附着在主行上
  isBackground: boolean
  // 对齐方向：未指定时按 isDuet 推导（true -> 'right'，false -> 'left'）；多人/群组合唱为 'center'
  align?: LyricAlign
  // 演唱者/组合标识，对应 ResolvedLyrics.agents 的键（单声部曲目省略）
  agent?: string
  // 背景人声相对所属主唱行的位置（above 紧邻在主行之前，below 紧邻在主行之后）
  backgroundPosition?: 'above' | 'below'
  // 新段落（TTML <div>）的首行主唱：在上一行之后额外留出段落间距
  paragraphStart?: boolean
  // 强调特效（只有逐字歌词有）：按演唱时长规则与歌词标注计算，见 emphasis.ts
  emphasis?: LyricEmphasis[]
  // 这一行的情绪基调（来自歌词标注），影响强调辉光的颜色
  mood?: LyricMood
  // 从这一行开始的全屏粒子场景（来自歌词标注，只在播放器页演出），持续若干行或到下一个标了场景的行，见 stage-effects.ts；
  // custom:<name> 为这首歌的自定义粒子（ResolvedLyrics.sprites）
  scene?: LyricSceneName
  // 粒子场景的颜色主题（色板中的名称），为空时用场景默认色
  sceneColor?: LyricColor
  // 粒子场景持续的主唱行数（含这一行，由模型按意象的段落给出），为空时按默认行数（见 stage-effects.ts 的 SCENE_MAX_LINES）
  sceneLines?: number
  // 一段副歌的第一行（来自歌词标注）：强调加强，播放器页全屏爆发一次
  chorusStart?: boolean
}

/** 音译的一段：显示在原文第 word 个词（音节）的下方，演唱时间取自该音节；text 末尾的空格表示一个音译词结束 */
export interface LyricRomanWord {
  text: string
  start: number
  end: number
  word: number
}

/**
 * 强调特效的类型：swell 放大 + 辉光 + 上浮（默认），glow 只有辉光，wave 逐字波浪上浮，shake 震颤，focus 由虚到实，
 * dissolve 唱完后化成颗粒消散，shatter 唱完的一瞬间碎成碎片坠落，shimmer 流光扫过，heartbeat 心跳（时间曲线见 word-effects.ts）
 */
export type LyricEffect = 'swell' | 'glow' | 'wave' | 'shake' | 'focus' | 'dissolve' | 'shatter' | 'shimmer' | 'heartbeat'

export type LyricMood = 'calm' | 'bright' | 'sad' | 'intense'

/** 全屏粒子场景（与后端 lyricAnnotationSceneList 一致），绘制见 stage-particles.ts */
export type LyricScene
  = | 'petals' | 'sparks' | 'snow' | 'stars' | 'bubbles' | 'rain'
    | 'leaves' | 'fireflies' | 'feathers' | 'hearts' | 'confetti' | 'fireworks'
    | 'dandelion' | 'butterflies' | 'meteors' | 'clouds' | 'ripples' | 'notes'

/** 行的粒子场景：内置场景，或 custom:<name> 指向这首歌的自定义粒子 */
export type LyricSceneName = LyricScene | `custom:${string}`

/** 自定义粒子的动作预设：落下、上飘、横向滑过、摇摆、打旋、从中间散开 */
export type LyricSpriteMotion = 'fall' | 'float' | 'drift' | 'sway' | 'swirl' | 'burst'

/**
 * 自定义粒子（来自歌词标注，见 spec 7.2m）：图标库中的图标（paint 为 line）或模型画的 24×24 简单剪影（fill / light / stroke），
 * 只在粒子画布上用 Path2D 绘制；动作、大小、是否自转与颜色由模型从预设中选
 */
export interface LyricSprite {
  name: string
  label?: string
  icon?: string
  paths: { d: string, paint: 'fill' | 'light' | 'stroke' | 'line' }[]
  motion: LyricSpriteMotion
  size: 's' | 'm' | 'l'
  spin?: boolean
  color: LyricColor
}

/** 强调短语的颜色：语义化色板中的名称（来自歌词标注，与后端 lyricAnnotationPalette 一致），具体色值见 colors.ts */
export type LyricColor
  = | 'crimson' | 'rose' | 'flame' | 'sunset' | 'coral' | 'maple' | 'amber' | 'peach'
    | 'cherry-blossom' | 'bauhinia' | 'sunshine' | 'gold' | 'lemon' | 'candlelight' | 'spring-green' | 'forest'
    | 'mint' | 'jade' | 'aurora' | 'lake' | 'sky' | 'ocean' | 'starry-blue' | 'midnight'
    | 'ice' | 'rain' | 'lavender' | 'violet' | 'twilight' | 'wisteria' | 'moonlight' | 'silver'

/** 歌词字体（来自歌词标注，与后端 lyricAnnotationFontList 一致），字体栈见 lyric-player.css */
export type LyricFont = 'song' | 'kai' | 'xingkai' | 'fangsong' | 'round' | 'mono' | 'script'

/** 短语字形：粗体、斜体、下划线（下划线在演唱时逐字画出） */
export type LyricTextStyle = 'bold' | 'italic' | 'underline'

/**
 * 一组强调的词：words[from, to)，在 [start, end) 内演出，factor 为强度（0 ~ 1，为 0 时不做动效、只保留样式），
 * color 为演唱时的上色，font / styles 为字体与字形（均可选）
 */
export interface LyricEmphasis {
  from: number
  to: number
  start: number
  end: number
  factor: number
  effect: LyricEffect
  color?: LyricColor
  font?: LyricFont
  styles?: LyricTextStyle[]
  // shake 组里唱得特别长的音节（长音）的时段：先按 swell 放大，唱了一会儿后整个词开始颤音（见 lyric-player.ts）
  hold?: { start: number, end: number }
}

export type LyricSource = 'ttml-custom' | 'ttml-amll' | 'ncm-yrc' | 'ncm-lrc' | 'qq-qrc' | 'qq-lrc' | 'kugou-krc' | 'kugou-lrc' | 'none'

export interface ResolvedLyrics {
  source: LyricSource
  // 来源的名称：自定义 TTML 源在后台配置的名称，没有时按 source 显示通用名称
  sourceName?: string
  // 是否有词级时间（逐字擦除）；行级歌词只做整行高亮
  wordTimed: boolean
  // 纯音乐（接口明确标记没有歌词）
  instrumental: boolean
  lines: LyricLine[]
  // 全曲字体（来自歌词标注），为空时用站点默认字体
  font?: LyricFont
  // 前奏导语、尾奏热评与关键节点的「时刻」（来自歌词标注），见 moments.ts
  intro?: string
  outro?: LyricOutro
  notes?: LyricNote[]
  // 这首歌的自定义粒子（来自歌词标注），按名称索引
  sprites?: Record<string, LyricSprite>
  // 聚光灯（来自歌词标注）：全曲最点题的 1～3 句每次出现的行号（升序），唱到时移到中央放大、身后亮起暖光，见 stage-effects.ts 的 spotlightAt
  spotlights?: number[]
  // 这首歌的主题色（来自歌词标注，#rrggbb）：歌词辉光与背景呼吸的默认颜色，没有时用封面主色
  accent?: string
  // 多声部曲目的演唱者/群组元信息表（单人独唱曲目不设置）
  agents?: Record<string, LyricAgent>
}

/** 关键节点的「时刻」：在 start（毫秒，对应歌词行开唱）时显示的热评或模型写的旁白 */
export interface LyricNote {
  start: number
  content: string
  source: 'comment' | 'ai'
  liked?: number
}

/** 尾奏时展示的一条网易云热评 */
export interface LyricOutro {
  content: string
  liked: number
}

export const EMPTY_LYRICS: ResolvedLyrics = { source: 'none', wordTimed: false, instrumental: false, lines: [] }
