import type { LyricAnnotations } from '@/lib/lyrics/emphasis'
import type { LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricSource } from '@/lib/lyrics/types'
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

// refresh：读者「重新获取歌词」，后端跳过缓存中「没有歌词」的记录（各来源相同）
const refreshParams = (refresh?: boolean) => (refresh ? { refresh: 1 } : undefined)

export async function fetchNcmLyric(id: number, signal?: AbortSignal, refresh?: boolean): Promise<MusicLyrics> {
  const res = await axiosClient.get<BaseResponse<MusicLyrics>>(`/music/song/${id}/lyric`, { signal, params: refreshParams(refresh) })
  return res.data.data
}

// TTML 歌词：custom 为站长配置的自定义源，amll 为 AMLL TTML DB
export interface MusicTtmlLyric {
  source: 'custom' | 'amll'
  ttml: string
}

// 按网易云歌曲 id 取 TTML 歌词（后端并发探测自定义源与 AMLL 各镜像）；没有时返回 null
export async function fetchTtmlLyric(id: number, signal?: AbortSignal, refresh?: boolean): Promise<MusicTtmlLyric | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicTtmlLyric>>(`/music/song/${id}/lyric/ttml`, { signal, params: refreshParams(refresh) })
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

// 按网易云歌曲 id 取 QQ 音乐歌词（与其余来源一起请求，按质量选择）；没有匹配或没有歌词时返回 null
export async function fetchQqLyric(id: number, signal?: AbortSignal, refresh?: boolean): Promise<MusicQqLyric | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicQqLyric>>(`/music/song/${id}/lyric/qq`, { signal, params: refreshParams(refresh) })
    return res.data.data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 404)
      return null
    throw error
  }
}

// 酷狗音乐歌词：后端按网易云歌曲信息在酷狗匹配同一首歌，KRC 已解密并转换为与 QQ 音乐相同的格式
// （format 为 qrc 时 lyric 为逐字 QRC，翻译为 LRC，音译为逐字 QRC），可直接用 parseQqLyrics 解析
export interface MusicKugouLyric {
  hash: string
  format: 'qrc' | 'lrc' | ''
  lyric: string
  translation: string
  romanization: string
}

// 按网易云歌曲 id 取酷狗音乐歌词（与其余来源一起请求，按质量选择）；没有匹配或没有歌词时返回 null
export async function fetchKugouLyric(id: number, signal?: AbortSignal, refresh?: boolean): Promise<MusicKugouLyric | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicKugouLyric>>(`/music/song/${id}/lyric/kugou`, { signal, params: refreshParams(refresh) })
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
  font?: LyricAnnotations['font']
  pace?: LyricAnnotations['pace']
  intro?: LyricAnnotations['intro']
  outro?: LyricAnnotations['outro']
  moments?: LyricAnnotations['moments']
  spotlights?: LyricAnnotations['spotlights']
  accent?: LyricAnnotations['accent']
  lines: LyricAnnotations['lines']
  sprites?: LyricAnnotations['sprites']
  edited?: boolean
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

// 歌词的人工设置：各歌词来源（ResolvedLyrics.source）的整体偏移（毫秒，正数让歌词推迟、负数提前），没有设置的来源不出现；
// pin 为管理员选定的全站默认歌词来源，没有时按质量自动选择
export interface MusicLyricSettings {
  offsets: Partial<Record<LyricSource, number>>
  pin?: LyricSourceKind
}

export async function fetchLyricSettings(id: number): Promise<MusicLyricSettings> {
  const res = await axiosClient.get<BaseResponse<MusicLyricSettings>>(`/music/song/${id}/lyric/settings`)
  return res.data.data
}

// 管理员设置全站默认歌词来源，为 null 时取消（恢复按质量自动选择）
export async function saveLyricPin(id: number, kind: LyricSourceKind | null): Promise<void> {
  await axiosClient.put(`/music/song/${id}/lyric/pin`, { kind: kind ?? '' })
}

// 管理员保存某一歌词来源的整体偏移（毫秒），为 0 时清除；对所有人生效
export async function saveLyricOffset(id: number, source: LyricSource, offsetMs: number): Promise<void> {
  await axiosClient.put(`/music/song/${id}/lyric/offset`, { source, offsetMs })
}

// 后台歌词特效列表中的一条：已有标注的歌曲、短语数、生成与手动编辑的时间
export interface MusicLyricAnnotationSummary {
  songId: number
  phrases: number
  generatedAt: string
  editedAt?: string
  model?: string
}

export async function listLyricAnnotations(): Promise<MusicLyricAnnotationSummary[]> {
  const res = await axiosClient.get<BaseResponse<MusicLyricAnnotationSummary[]>>('/music/lyric/annotations')
  return res.data.data ?? []
}

// 后台编辑一首歌的歌词标注：lines 为完整歌词（按顺序、含重复的行），annotation 为当前标注（还没有时为 null）
export interface MusicLyricAnnotationEditor {
  lines: string[]
  annotation: MusicLyricAnnotations | null
  editedAt?: string
  generatedAt?: string
  model?: string
  generating: boolean
}

// 手动编辑可改的部分：全曲字体、节奏、导语、主题色、聚光灯与各行（时刻与尾奏热评保持原样）
export interface MusicLyricAnnotationsEdit {
  font?: LyricAnnotations['font']
  pace?: LyricAnnotations['pace']
  intro?: string
  accent?: string
  spotlights: NonNullable<LyricAnnotations['spotlights']>
  lines: LyricAnnotations['lines']
}

export async function fetchLyricAnnotationEditor(id: number): Promise<MusicLyricAnnotationEditor> {
  const res = await axiosClient.get<BaseResponse<MusicLyricAnnotationEditor>>(`/music/song/${id}/lyric/annotations/editor`)
  return res.data.data
}

export async function saveLyricAnnotations(id: number, edit: MusicLyricAnnotationsEdit): Promise<MusicLyricAnnotationEditor> {
  const res = await axiosClient.put<BaseResponse<MusicLyricAnnotationEditor>>(`/music/song/${id}/lyric/annotations`, edit)
  return res.data.data
}

// 歌词缓存快照：最近一次选出的最佳来源（kind）与各来源的原始数据（与各来源接口的返回相同），打开时先用它立即显示
export interface MusicLyricCache {
  kind: 'ttml' | 'ncm' | 'qq' | 'kugou'
  ncm?: MusicLyrics
  ttml?: MusicTtmlLyric
  qq?: MusicQqLyric
  kugou?: MusicKugouLyric
}

// 没有缓存或已过期时为 null
export async function fetchLyricCache(id: number): Promise<MusicLyricCache | null> {
  try {
    const res = await axiosClient.get<BaseResponse<MusicLyricCache>>(`/music/song/${id}/lyric/cache`)
    return res.data.data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 404)
      return null
    throw error
  }
}

// 上报选出的最佳来源，后端用自己获取的来源数据更新缓存（不上传歌词内容）
export async function saveLyricCache(id: number, kind: MusicLyricCache['kind']): Promise<void> {
  await axiosClient.post(`/music/song/${id}/lyric/cache`, { kind })
}

// 网易云标出的副歌 / 高潮片段（毫秒）；没有时为空数组
export interface MusicChorus {
  start: number
  end: number
}

export async function fetchSongChorus(id: number): Promise<MusicChorus[]> {
  const res = await axiosClient.get<BaseResponse<MusicChorus[]>>(`/music/song/${id}/chorus`)
  return res.data.data ?? []
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
