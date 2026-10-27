'use client'

import type { ContentEditorActionProps } from '../types'
import type { NeteaseSongInput } from './schema'
import { NeteaseSongSearch } from './netease-song-search'

/**
 * 单曲卡的「搜索歌曲」：复用与歌词摘录共用的网易云歌曲搜索
 */
export default function NeteaseSongAction({ values, setValues }: ContentEditorActionProps<NeteaseSongInput>) {
  // 自定义音频不需要搜索
  if (values.mode === 'custom')
    return null

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <NeteaseSongSearch value={Number(values.id) || 0} onSelect={song => setValues({ id: song.id })} />
    </div>
  )
}
