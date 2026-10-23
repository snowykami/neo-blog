import type { NeteaseSongProps } from './schema'
import { Music2Icon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { defineContentComponent } from '../define'
import { neteaseSongSchema } from './schema'

export default defineContentComponent({
  name: 'neteaseSong',
  version: 1,
  // 卡片内容紧凑，默认半宽
  defaultWidth: 50,
  schema: neteaseSongSchema,
  component: dynamic(() => import('./netease-song')),
  icon: Music2Icon,
  keywords: ['music', 'song', 'netease', 'ncm', 'yinyue', 'yy', 'gequ', 'wangyiyun', 'wyy', '音乐', '歌曲', '网易云', '单曲'],
  fallback: ({ id }: NeteaseSongProps) => [
    ['p', {}, ['a', { href: `https://music.163.com/#/song?id=${id}`, target: '_blank', rel: 'noopener noreferrer' }, `music.163.com/#/song?id=${id}`]],
  ],
  example: () => ({ id: 1824020871 }),
  editor: {
    // 「搜索歌曲」：按关键词搜索网易云歌曲，点击结果填入歌曲 ID
    action: dynamic(() => import('./netease-song-action')),
  },
})
