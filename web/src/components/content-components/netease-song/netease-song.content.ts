import type { NeteaseSongProps } from './schema'
import { Music2Icon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { MUSIC_CARD_MODE_FIELDS, neteaseSongSchema } from './schema'

// 组件名沿用 neteaseSong 以兼容已插入的卡片；现支持网易云歌曲与自定义音频两种模式
export default defineContentComponent({
  name: 'neteaseSong',
  version: 1,
  // 卡片内容紧凑，默认半宽
  defaultWidth: 50,
  schema: neteaseSongSchema,
  component: dynamic(() => import('./netease-song')),
  icon: Music2Icon,
  keywords: ['music', 'song', 'audio', 'netease', 'ncm', 'yinyue', 'yy', 'gequ', 'wangyiyun', 'wyy', 'yinpin', '音乐', '歌曲', '网易云', '单曲', '音频'],
  fallback: ({ mode, id, title, artist, src }: NeteaseSongProps) => {
    if (mode === 'custom') {
      const text = [title, artist].filter(Boolean).join(' - ')
      return [['p', {}, src ? ['a', { href: src, target: '_blank', rel: 'noopener noreferrer' }, text] : text]]
    }
    return [['p', {}, ['a', { href: `https://music.163.com/#/song?id=${id}`, target: '_blank', rel: 'noopener noreferrer' }, `music.163.com/#/song?id=${id}`]]]
  },
  example: () => ({ id: 1824020871 }),
  editor: {
    // 「搜索歌曲」：按关键词搜索网易云歌曲，点击结果填入歌曲 ID（只在网易云模式下显示）
    action: dynamic(() => import('./netease-song-action')),
    isFieldVisible: (name, { mode }) => MUSIC_CARD_MODE_FIELDS[mode ?? 'netease'].includes(name),
  },
})
