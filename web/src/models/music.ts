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
