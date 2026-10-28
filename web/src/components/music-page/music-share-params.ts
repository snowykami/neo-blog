/**
 * 播放器页的分享参数（见 spec 5.6）：/music?id=歌曲 id&start=开始秒数。
 * 播放器页实时把当前曲目与进度写进地址（方便复制分享），打开带参数的地址时定位到该曲目与进度
 */

export const MUSIC_PAGE_PATH = '/music'

// start 保留两位小数
const START_DECIMALS = 2

export interface MusicShareParams {
  id: number | null
  start: number | null
}

/** 解析地址中的 id 与 start；不合法的值视为没有 */
export function parseMusicShareParams(search: string): MusicShareParams {
  const params = new URLSearchParams(search)
  const id = Number(params.get('id'))
  const startRaw = params.get('start')
  const start = startRaw == null || startRaw.trim() === '' ? Number.NaN : Number(startRaw)
  return {
    id: Number.isSafeInteger(id) && id > 0 ? id : null,
    start: Number.isFinite(start) && start >= 0 ? start : null,
  }
}

/** 开始秒数的文本：保留两位小数 */
export function formatMusicStart(seconds: number): string {
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 0).toFixed(START_DECIMALS)
}

/** 在现有查询参数的基础上写入 id 与 start（其他参数保留） */
export function buildMusicShareSearch(search: string, id: number, seconds: number): string {
  const params = new URLSearchParams(search)
  params.set('id', String(id))
  params.set('start', formatMusicStart(seconds))
  return `?${params.toString()}`
}

/** 当前页面是否为带分享参数的播放器页：是时返回参数，否则为 null */
export function readMusicShareParamsFromLocation(): MusicShareParams | null {
  if (typeof window === 'undefined' || window.location.pathname !== MUSIC_PAGE_PATH)
    return null
  const params = parseMusicShareParams(window.location.search)
  return params.id == null ? null : params
}
