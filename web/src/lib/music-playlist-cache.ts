import type { MusicTrack } from '@/models/music'

// 歌单本地缓存：播放器先用上次的歌单渲染（悬浮球立刻出现、恢复上次的曲目），不必每次打开页面都下载整份歌单。
// version 是后端按歌单内容算的指纹：内容没变就不再下载；本地副本最多用这么久（兜底），过期后重新获取

const STORAGE_KEY = 'music-playlist'
// 本地副本的最长使用时间：版本校验接口出问题时也不会一直用陈旧数据
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface MusicPlaylistCache {
  version: string
  tracks: MusicTrack[]
}

interface StoredPlaylist extends MusicPlaylistCache {
  savedAt: number
}

/** 读取本地歌单：没有、已过期或数据不可用时返回 null（不可用的顺手清掉，下次重新下载） */
export function readPlaylistCache(): MusicPlaylistCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return null
    const stored = JSON.parse(raw) as StoredPlaylist | null
    const valid = stored
      && typeof stored.version === 'string'
      && typeof stored.savedAt === 'number'
      && Date.now() - stored.savedAt <= MAX_AGE_MS
      && Array.isArray(stored.tracks)
      && stored.tracks.length > 0
      && stored.tracks.every(isTrack)
    if (!valid) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { version: stored.version, tracks: stored.tracks }
  }
  catch {
    return null
  }
}

/** 写入本地歌单：容量不足等原因写不进去时忽略，只是下次还要重新下载 */
export function writePlaylistCache(version: string, tracks: MusicTrack[]) {
  try {
    const stored: StoredPlaylist = { version, tracks, savedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  catch { }
}

// 只做形状校验：本地数据可能被旧版本写入或被其他脚本改坏，坏数据会让播放器直接崩掉
function isTrack(track: unknown): track is MusicTrack {
  const value = track as MusicTrack | null
  return typeof value?.id === 'number'
    && typeof value.name === 'string'
    && typeof value.album === 'string'
    && typeof value.audio === 'string'
    && Array.isArray(value.artists)
    && Array.isArray(value.aliases)
}
