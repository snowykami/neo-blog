import type { LyricAnnotations } from '@/lib/lyrics/emphasis'
import type { MusicSearchSong, MusicSong, MusicSource, MusicTrack, NCMPlaylists } from '@/models/music'
import type { BaseResponse } from '@/models/resp'
import { isAxiosError } from 'axios'
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

// TTML 歌词：custom 为站长配置的自定义源，amll 为 AMLL TTML DB
export interface MusicTtmlLyric {
  source: 'custom' | 'amll'
  ttml: string
}

// 按网易云歌曲 id 取 TTML 歌词（后端并发探测自定义源与 AMLL 各镜像）；没有时返回 null
export async function fetchTtmlLyric(id: number, signal?: AbortSignal): Promise<MusicTtmlLyric | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicTtmlLyric>>(`/music/song/${id}/lyric/ttml`, { signal })
    return res.data.data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 404)
      return null
    throw error
  }
}

// QQ 音乐歌词：后端按网易云歌曲信息在 QQ 音乐匹配同一首歌，正文已解密；ttml 为 AMLL TTML DB 按这首 QQ 歌曲收录的 TTML
export interface MusicQqLyric {
  songMid: string
  format: 'qrc' | 'lrc' | ''
  lyric: string
  translation: string
  romanization: string
  ttml?: string
}

// 按网易云歌曲 id 取 QQ 音乐歌词（网易云没有逐字歌词时的兜底）；没有匹配或没有歌词时返回 null
export async function fetchQqLyric(id: number, signal?: AbortSignal): Promise<MusicQqLyric | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicQqLyric>>(`/music/song/${id}/lyric/qq`, { signal })
    return res.data.data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 404)
      return null
    throw error
  }
}

// 歌词标注（后端用大模型对歌词文本的标注）：status 为 pending 时正在生成，稍后再取；只引用歌词文本，不含时间。
// stale 为 true 时 lines 是旧结果（已过期或管理员刷新），后台正在重新生成
export interface MusicLyricAnnotations {
  status: 'ready' | 'pending'
  stale?: boolean
  lines: LyricAnnotations['lines']
}

// 只为博客歌单内的歌曲生成；没有配置大模型、不在歌单内或生成失败时返回 null
export async function fetchLyricAnnotations(id: number): Promise<MusicLyricAnnotations | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicLyricAnnotations>>(`/music/song/${id}/lyric/annotations`)
    return res.data.data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 404)
      return null
    throw error
  }
}

// 管理员手动重新生成一首歌的歌词标注，之后通过 fetchLyricAnnotations 取结果
export async function refreshLyricAnnotations(id: number): Promise<MusicLyricAnnotations> {
  const res = await axiosClient.post<BaseResponse<MusicLyricAnnotations>>(`/music/song/${id}/lyric/annotations/refresh`)
  return res.data.data
}

// 单曲公开信息（任意歌曲），播放仍只限博客歌单内的歌曲
export async function getMusicSong(id: number): Promise<MusicSong> {
  const res = await axiosClient.get<BaseResponse<MusicSong>>(`/music/song/${id}`)
  return res.data.data
}

// 搜索网易云歌曲（编辑者及以上），用于在编辑器中为单曲卡选择歌曲
export async function searchMusicSongs(keywords: string): Promise<MusicSearchSong[]> {
  const res = await axiosClient.get<BaseResponse<MusicSearchSong[]>>('/music/search', { params: { keywords } })
  return res.data.data
}

// 获取网易云账号的歌单（仅管理员）；参数为空时使用已保存的配置
export async function listNCMPlaylists(params: { apiBaseUrl: string, cookie: string }): Promise<BaseResponse<NCMPlaylists>> {
  const res = await axiosClient.post('/music/ncm/playlists', params)
  return res.data
}
