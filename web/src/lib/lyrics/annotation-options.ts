import type { LyricColor, LyricEffect, LyricFont, LyricMood, LyricScene, LyricTextStyle } from './types'
import { LYRIC_COLORS } from './colors'

/**
 * 歌词标注各字段可选的值（后台歌词特效编辑器使用，与后端 music_annotation.go 的校验表一致）。
 * 特效按「这几个字在做什么」分为五类（与提示词的分类、docs/prototypes/lyric-effects/categories.html 一致）
 */
export interface LyricEffectCategory {
  key: 'grow' | 'tremble' | 'light' | 'focus' | 'vanish'
  // 类别的标识色（编辑器中短语下方的色条）
  color: string
  effects: LyricEffect[]
}

export const LYRIC_EFFECT_CATEGORIES: LyricEffectCategory[] = [
  { key: 'grow', color: '#f59e0b', effects: ['swell', 'heartbeat', 'wave'] },
  { key: 'tremble', color: '#f97316', effects: ['shake'] },
  { key: 'light', color: '#eab308', effects: ['glow', 'shimmer'] },
  { key: 'focus', color: '#3b82f6', effects: ['focus'] },
  { key: 'vanish', color: '#a855f7', effects: ['dissolve', 'shatter'] },
]

export function lyricEffectCategory(effect: LyricEffect): LyricEffectCategory {
  return LYRIC_EFFECT_CATEGORIES.find(category => category.effects.includes(effect)) ?? LYRIC_EFFECT_CATEGORIES[0]
}

export const LYRIC_MOODS: LyricMood[] = ['calm', 'bright', 'sad', 'intense']

export const LYRIC_SCENES: LyricScene[] = [
  'petals',
  'sparks',
  'snow',
  'stars',
  'bubbles',
  'rain',
  'leaves',
  'fireflies',
  'feathers',
  'hearts',
  'confetti',
  'fireworks',
  'dandelion',
  'butterflies',
  'meteors',
  'clouds',
  'ripples',
  'notes',
]

export const LYRIC_FONTS: LyricFont[] = ['song', 'kai', 'xingkai', 'fangsong', 'round', 'mono', 'script']

export const LYRIC_TEXT_STYLES: LyricTextStyle[] = ['bold', 'italic', 'underline']

export const LYRIC_COLOR_NAMES = Object.keys(LYRIC_COLORS) as LyricColor[]

// 导语的长度上限（与后端 lyricAnnotationMaxIntroRunes 一致）
export const LYRIC_INTRO_MAX = 60
