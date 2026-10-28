export interface MusicTrack {
  id: number
  name: string
  artists: string[]
  album: string
  albumPic: string
  audio: string
  lyric: string
  link: string
  aliases: string[]
  duration?: number // 时长（毫秒）；静态歌单可不提供
}

// 单曲公开信息（文章内的单曲卡），不含播放地址
export interface MusicSong {
  id: number
  name: string
  artists: string[]
  album: string
  albumPic: string
  link: string
  duration?: number // 时长（毫秒）
  // 当前访客能否在站内播放：博客歌单、公开文章引用的歌曲，或登录的管理员与编辑（见后端 music_whitelist.go）
  playable?: boolean
}

/** 不在歌单内、但可以在站内播放的单曲（文章引用的歌曲）转为播放队列中的曲目；播放地址与歌单曲目相同，由后端按白名单校验 */
export function songToTrack(song: MusicSong): MusicTrack {
  return {
    id: song.id,
    name: song.name,
    artists: song.artists,
    album: song.album,
    albumPic: song.albumPic,
    audio: `/api/v1/music/song/${song.id}/audio`,
    lyric: '',
    link: song.link || `https://music.163.com/#/song?id=${song.id}`,
    aliases: [],
    duration: song.duration,
  }
}

// 悬浮播放器的歌单来源：静态 JSON 地址，或后台配置的网易云歌单
export type MusicSourceType = 'static' | 'ncm'

export type MusicSource = { type: 'ncm' } | { type: 'static', url: string }

// 网易云播放音质（与后端 tools.NCMSongLevels 一致），只包含浏览器可以直接播放的格式
export const NCM_SONG_LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const

export type NCMSongLevel = typeof NCM_SONG_LEVELS[number]

export interface NCMPlaylist {
  id: number
  name: string
  cover: string
  trackCount: number
  subscribed: boolean // 收藏的歌单（非自己创建）
}

export interface NCMPlaylists {
  account: {
    userId: number
    nickname: string
    avatar: string
  }
  playlists: NCMPlaylist[]
}

// 网易云歌曲搜索结果（编辑器中为单曲卡选择歌曲）
export interface MusicSearchSong {
  id: number
  name: string
  artists: string[]
  album: string
  albumPic: string
  aliases: string[]
  duration: number // 时长（毫秒）
  inPlaylist: boolean // 是否在博客歌单内（可在站内播放）
}
