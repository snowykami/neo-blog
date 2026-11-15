type SongLyricsCacheClearer = (songId?: number) => void

let clearer: SongLyricsCacheClearer | null = null

/** 注册客户端歌词内存缓存清理器，由 song-lyrics 模块加载时调用，避免 api/music 静态引入歌词解析器 */
export function registerClientSongLyricsCacheClearer(fn: SongLyricsCacheClearer): void {
  clearer = fn
}

/** 通知已加载的歌词缓存模块清空缓存；若尚未加载则为无操作 */
export function notifyClientSongLyricsCacheClear(songId?: number): void {
  clearer?.(songId)
}
