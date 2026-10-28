/**
 * 播放器页歌词引擎的数据模型（见 docs/music-player-spec.md 7.3）；时间单位均为毫秒。
 * 逐词音译、注音等 TTML 特有字段在第三期加入
 */

export interface LyricWord {
  text: string
  start: number
  end: number
}

export interface LyricLine {
  words: LyricWord[]
  // 行的开始时间：经过预处理的「提前起唱」后可能早于第一个词，用于高亮与滚动
  start: number
  end: number
  translation?: string
  romanization?: string
  // 逐字音译（与原文的音节对齐，显示在原文下方并随演唱擦除）；对不齐时为空，只显示整行音译
  romanizationWords?: LyricRomanWord[]
  // 对唱：右对齐显示
  isDuet: boolean
  // 背景人声：附着在主行上
  isBackground: boolean
  // 强调特效（只有逐字歌词有）：按演唱时长规则与歌词标注计算，见 emphasis.ts
  emphasis?: LyricEmphasis[]
  // 这一行的情绪基调（来自歌词标注），影响强调辉光的颜色
  mood?: LyricMood
  // 从这一行开始的全屏粒子场景（来自歌词标注，只在播放器页演出），持续若干行或到下一个标了场景的行，见 stage-effects.ts
  scene?: LyricScene
  // 粒子场景的颜色主题（色板中的名称），为空时用场景默认色
  sceneColor?: LyricColor
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

/** 强调特效的类型：swell 放大 + 辉光 + 上浮（默认），glow 只有辉光，wave 逐字波浪上浮，shake 震颤，focus 由虚到实 */
export type LyricEffect = 'swell' | 'glow' | 'wave' | 'shake' | 'focus'

export type LyricMood = 'calm' | 'bright' | 'sad' | 'intense'

/** 全屏粒子场景（与后端 lyricAnnotationSceneList 一致），绘制见 stage-particles.ts */
export type LyricScene
  = | 'petals' | 'sparks' | 'snow' | 'stars' | 'bubbles' | 'rain'
    | 'leaves' | 'fireflies' | 'feathers' | 'hearts' | 'confetti' | 'fireworks'
    | 'dandelion' | 'butterflies' | 'meteors' | 'clouds' | 'ripples' | 'notes'

/** 强调短语的颜色：语义化色板中的名称（来自歌词标注，与后端 lyricAnnotationPalette 一致），具体色值见 colors.ts */
export type LyricColor
  = | 'crimson' | 'rose' | 'flame' | 'sunset' | 'coral' | 'maple' | 'amber' | 'peach'
    | 'cherry-blossom' | 'bauhinia' | 'sunshine' | 'gold' | 'lemon' | 'candlelight' | 'spring-green' | 'forest'
    | 'mint' | 'jade' | 'aurora' | 'lake' | 'sky' | 'ocean' | 'starry-blue' | 'midnight'
    | 'ice' | 'rain' | 'lavender' | 'violet' | 'twilight' | 'wisteria' | 'moonlight' | 'silver'

/** 歌词字体（来自歌词标注，与后端 lyricAnnotationFontList 一致），字体栈见 lyric-player.css */
export type LyricFont = 'song' | 'kai' | 'xingkai' | 'fangsong' | 'round' | 'mono' | 'script'

/** 短语字形：粗体、斜体、下划线、删除线（下划线与删除线在演唱时逐字画出） */
export type LyricTextStyle = 'bold' | 'italic' | 'underline' | 'strike'

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
