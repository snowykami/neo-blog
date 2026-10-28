'use client'

import type { MusicLyrics, MusicQqLyric, MusicTtmlLyric } from '@/api/music'
import type { LyricCandidate, LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricTrackInfo } from '@/lib/lyrics/strip-credits'
import type { ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicLyricParseResult } from '@/utils/music-lyric'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { fetchNcmLyric, fetchQqLyric, fetchTtmlLyric } from '@/api/music'
import { platformToLyrics } from '@/lib/lyrics/from-platform'
import { parseTtml } from '@/lib/lyrics/parse-ttml'
import { resolveLyrics } from '@/lib/lyrics/resolve'
import { withRomanizationWords } from '@/lib/lyrics/romanization'
import { parseMusicLyrics, parseQqLyrics } from '@/utils/music-lyric'

/**
 * 全站共用的歌词来源（见 spec 2.3、2.4、7.4）：按网易云歌曲 id 获取并缓存，播放器页、悬浮播放器、导航栏、
 * 文章内的单曲卡与歌词摘录都从这里取，同一首歌只请求一次，按同一套规则选出同一份歌词。
 * - 网易云与 TTML 并发请求；网易云不是逐字、且 TTML 还没有命中时才请求 QQ 音乐（同 StarryPlayer：先问歌曲自己的平台）；
 *   读者为这首歌固定了 QQ 音乐时立即请求
 * - 来源的值：undefined 为请求中（或尚未请求），null 为没有或请求失败；失败的来源在下次需要时重试
 */

export interface SongLyricSources {
  ncm?: MusicLyrics | null
  ttml?: MusicTtmlLyric | null
  qq?: MusicQqLyric | null
}

type SourceKey = keyof SongLyricSources

interface Entry {
  sources: SongLyricSources
  listeners: Set<() => void>
  started: Set<SourceKey>
  failed: Set<SourceKey>
  // 已决定是否请求 QQ 音乐；qqRequested 为真正发出了请求
  qqDecided: boolean
  qqRequested: boolean
  ttmlFound: boolean
}

// 最多缓存的歌曲数，超出时淘汰最久未使用且没有组件在用的
const MAX_ENTRIES = 100
const entries = new Map<number, Entry>()

function getEntry(id: number): Entry {
  const existing = entries.get(id)
  if (existing) {
    // 按使用顺序排列（Map 按插入顺序遍历）
    entries.delete(id)
    entries.set(id, existing)
    return existing
  }
  const entry: Entry = { sources: {}, listeners: new Set(), started: new Set(), failed: new Set(), qqDecided: false, qqRequested: false, ttmlFound: false }
  entries.set(id, entry)
  for (const [key, old] of entries) {
    if (entries.size <= MAX_ENTRIES)
      break
    if (old.listeners.size === 0)
      entries.delete(key)
  }
  return entry
}

function settle<K extends SourceKey>(entry: Entry, key: K, value: SongLyricSources[K], failed = false) {
  // 每次更新都换一个新对象，供 useSyncExternalStore 比较
  entry.sources = { ...entry.sources, [key]: value }
  if (failed)
    entry.failed.add(key)
  else
    entry.failed.delete(key)
  entry.listeners.forEach(listener => listener())
}

function request<K extends SourceKey>(entry: Entry, key: K, load: () => Promise<SongLyricSources[K]>, then?: (value: SongLyricSources[K]) => void) {
  entry.started.add(key)
  if (entry.failed.has(key)) {
    // 重试：先回到请求中
    const { [key]: _, ...rest } = entry.sources
    entry.sources = rest
    entry.listeners.forEach(listener => listener())
  }
  load().then((value) => {
    settle(entry, key, value)
    then?.(value)
  }, () => {
    settle(entry, key, null as SongLyricSources[K], true)
    then?.(null as SongLyricSources[K])
  })
}

function requestQq(id: number, entry: Entry) {
  entry.qqDecided = true
  entry.qqRequested = true
  request(entry, 'qq', () => fetchQqLyric(id))
}

/** 开始（或补齐、重试）获取一首歌的歌词来源；wantQq 为读者固定了 QQ 音乐 */
export function loadSongLyrics(id: number, { wantQq = false }: { wantQq?: boolean } = {}) {
  const entry = getEntry(id)
  const decideQq = (request: boolean) => {
    if (entry.qqDecided)
      return
    if (request) {
      requestQq(id, entry)
      return
    }
    entry.qqDecided = true
    settle(entry, 'qq', null)
  }
  if (!entry.started.has('ttml') || entry.failed.has('ttml')) {
    request(entry, 'ttml', () => fetchTtmlLyric(id), (value) => {
      entry.ttmlFound = value != null
    })
  }
  if (!entry.started.has('ncm') || entry.failed.has('ncm')) {
    request(entry, 'ncm', () => fetchNcmLyric(id), (value) => {
      decideQq(!entry.ttmlFound && (value == null || parseMusicLyrics(value).sourceType !== 'yrc'))
    })
  }
  if ((wantQq && !entry.qqRequested) || (entry.qqRequested && entry.failed.has('qq')))
    requestQq(id, entry)
}

const EMPTY_SOURCES: SongLyricSources = {}

/** 订阅一首歌的歌词来源并在需要时开始获取；id 为空或不大于 0（示例曲目）时不获取 */
export function useSongLyricSources(id: number | null, wantQq: boolean): SongLyricSources | null {
  const valid = id != null && id > 0
  const subscribe = useCallback((listener: () => void) => {
    if (!valid)
      return () => {}
    const entry = getEntry(id)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [id, valid])
  const sources = useSyncExternalStore(
    subscribe,
    () => (valid ? entries.get(id)?.sources ?? EMPTY_SOURCES : null),
    () => null,
  )
  useEffect(() => {
    if (valid)
      loadSongLyrics(id, { wantQq })
  }, [id, valid, wantQq])
  return sources
}

export interface SongLyrics {
  // 按来源等级与固定的来源选出的歌词（已预处理）
  lyrics: ResolvedLyrics
  // 已到达且有歌词的各来源（等级从高到低）与当前显示的来源
  candidates: LyricCandidate[]
  kind: LyricSourceKind | null
  // 仍有来源在请求中（已显示的歌词可能被更高等级的来源替换）
  pending: boolean
  // loading：请求中且还没有可显示的歌词；ready：有歌词；none：没有歌词或获取失败
  status: 'loading' | 'ready' | 'none'
  // 网易云歌词的解析结果（旧数据结构）
  ncmParsed: MusicLyricParseResult | null
}

function safely<T>(parse: () => T, label: string): T | null {
  try {
    return parse()
  }
  catch (error) {
    console.error(`Failed to parse ${label} lyrics:`, error)
    return null
  }
}

/** 一首歌最终显示的歌词：获取各来源并按同一套规则选择；track 用于去掉「歌名 - 歌手」等署名行 */
export function useResolvedSongLyrics(id: number | null, pin: LyricSourceKind | null, track?: LyricTrackInfo | null): SongLyrics {
  const sources = useSongLyricSources(id, pin === 'qq')
  const trackName = track?.name ?? ''
  const trackArtists = track?.artists
  const trackInfo = useMemo(() => ({ name: trackName, artists: trackArtists ?? [] }), [trackArtists, trackName])

  const ncm = sources?.ncm ?? null
  const qq = sources?.qq ?? null
  const ncmParsed = useMemo(() => (ncm ? safely(() => parseMusicLyrics(ncm), 'NetEase') : null), [ncm])
  const qqParsed = useMemo(() => (qq ? safely(() => parseQqLyrics(qq), 'QQ Music') : null), [qq])
  const ncmLyrics = useMemo(() => platformToLyrics(ncmParsed, 'ncm', trackInfo), [ncmParsed, trackInfo])
  const qqLyrics = useMemo(() => platformToLyrics(qqParsed, 'qq', trackInfo), [qqParsed, trackInfo])
  // TTML：按网易云歌曲收录的优先，其次是按匹配到的 QQ 歌曲收录的
  const ttmlText = sources?.ttml?.ttml ?? qq?.ttml ?? null
  const ttmlKind = sources?.ttml?.source === 'custom' ? 'ttml-custom' : 'ttml-amll'
  const ttmlLyrics = useMemo(() => (ttmlText ? safely(() => parseTtml(ttmlText, ttmlKind), 'TTML') : null), [ttmlKind, ttmlText])

  return useMemo(() => {
    const resolution = resolveLyrics({ ttml: ttmlLyrics, ncm: ncmLyrics, ncmParsed, qq: qqLyrics, qqParsed, pin })
    const pending = sources != null && (sources.ncm === undefined || sources.ttml === undefined || sources.qq === undefined)
    return {
      // 音译对齐到原文音节（逐字音译）
      lyrics: withRomanizationWords(resolution.lyrics),
      candidates: resolution.candidates,
      kind: resolution.kind,
      pending,
      status: resolution.lyrics.lines.length > 0 ? 'ready' : pending ? 'loading' : 'none',
      ncmParsed,
    }
  }, [ncmLyrics, ncmParsed, pin, qqLyrics, qqParsed, sources, ttmlLyrics])
}
