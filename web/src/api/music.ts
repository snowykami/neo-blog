import type { MusicSource, MusicTrack, NCMPlaylists } from '@/models/music'
import type { BaseResponse } from '@/models/resp'
import { snakeToCamelObj } from 'field-conv'
import axiosClient from './client'

export interface MusicLyrics {
  lrc?: { lyric: string, version: number } | null
  tlyric?: { lyric: string, version: number } | null
  romalrc?: { lyric: string, version: number } | null
  yrc?: { lyric: string, version: number } | null
  ytlrc?: { lyric: string, version: number } | null
  yromalrc?: { lyric: string, version: number } | null
}

// 网易云歌单由后端提供；静态歌单直接读取 JSON 地址
export async function fetchPlaylist(source: MusicSource): Promise<MusicTrack[]> {
  if (source.type === 'ncm') {
    const res = await axiosClient.get<BaseResponse<MusicTrack[]>>('/music/playlist')
    return res.data.data
  }
  const response = await fetch(source.url)
  if (!response.ok) {
    throw new Error('Network response was not ok')
  }
  return snakeToCamelObj(await response.json())
}

export async function fetchNcmLyric(id: number, signal?: AbortSignal): Promise<MusicLyrics> {
  const res = await axiosClient.get<BaseResponse<MusicLyrics>>(`/music/song/${id}/lyric`, { signal })
  return res.data.data
}

// 获取网易云账号的歌单（仅管理员）；参数为空时使用已保存的配置
export async function listNCMPlaylists(params: { apiBaseUrl: string, cookie: string }): Promise<BaseResponse<NCMPlaylists>> {
  const res = await axiosClient.post('/music/ncm/playlists', params)
  return res.data
}
