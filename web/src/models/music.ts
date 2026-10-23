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
}

// 悬浮播放器的歌单来源：静态 JSON 地址，或后台配置的网易云歌单
export type MusicSourceType = 'static' | 'ncm'

export type MusicSource = { type: 'ncm' } | { type: 'static', url: string }

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
