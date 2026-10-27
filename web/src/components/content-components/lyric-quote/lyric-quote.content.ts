import type { LyricQuoteProps } from './schema'
import { QuoteIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { LYRIC_QUOTE_SOURCE_FIELDS, lyricQuoteSchema } from './schema'

// 歌词摘录：引用一句或一段歌词，点击播放从该句开始播放
export default defineContentComponent({
  name: 'lyricQuote',
  version: 1,
  // 引用通常附带歌曲信息，默认较宽
  defaultWidth: 75,
  schema: lyricQuoteSchema,
  component: dynamic(() => import('./lyric-quote')),
  icon: QuoteIcon,
  keywords: ['lyric', 'lyrics', 'quote', 'music', 'translation', 'romaji', 'pronunciation', 'geci', 'yinyue', 'fanyi', 'luomayin', '歌词', '摘录', '引用', '音乐', '单曲', '翻译', '发音', '罗马音'],
  fallback: ({ source, id, title, artist, text }: LyricQuoteProps) => {
    const lyric = text || (source === 'netease' && id > 0 ? `music.163.com/#/song?id=${id}` : '')
    const caption = [title, artist].filter(Boolean).join(' - ')
    return [['blockquote', {}, caption ? `${lyric} —— ${caption}` : lyric]]
  },
  example: t => ({
    source: 'custom' as const,
    title: t('title'),
    artist: t('artist'),
    src: '/api/v1/file/example.mp3',
    lyric: `[00:00.00]${t('lyric')}`,
    start: 0,
    text: t('lyric'),
  }),
  editor: {
    // 「选择歌词」：解析歌词并列出每一句，依次点击起始句和结束句
    action: dynamic(() => import('./lyric-quote-action')),
    // 翻译/发音歌词字段跟随各自的开关显示，关闭时保留已填内容
    isFieldVisible: (name, values) => {
      if (!LYRIC_QUOTE_SOURCE_FIELDS[values.source ?? 'netease'].includes(name))
        return false
      if (name === 'translation')
        return Boolean(values.showTranslation)
      if (name === 'romaji')
        return Boolean(values.showRomaji)
      return true
    },
  },
})
