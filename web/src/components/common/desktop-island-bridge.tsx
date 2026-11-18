'use client'

import type { PlayMode } from '@/contexts/music-context'
import type { DesktopIslandPreferences } from '@/hooks/use-desktop-island-pref'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { RhythmModel } from '@/lib/lyrics/rhythm/model'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { LyricAgent, ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fetchPlaylistTrack } from '@/api/music'
import { useCoverAccent, useSongAccent } from '@/components/music-page/use-cover-accent'
import {
  useMusicActions,
  useMusicClockStore,
  useMusicLyrics,
  useMusicPlayback,
  useMusicPreferences,
  useMusicVolume,
} from '@/contexts/music-context'
import { getCachedSongChorus, useSongChorus } from '@/contexts/song-chorus'
import { usePassiveResolvedSongLyrics } from '@/contexts/song-lyrics'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import {
  setDesktopIslandRuntimeStatus,
  updateDesktopIslandPrefs,
  useDesktopIslandPrefs,
  useDesktopIslandRuntime,
} from '@/hooks/use-desktop-island-pref'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useLanguageLabel } from '@/lib/language-label'
import { LYRIC_COLORS, MOOD_GLOW, resolveAgentHex } from '@/lib/lyrics/colors'
import { getBackgroundOwnerMap, getLyricLineAlign, getLyricLineVocalStart } from '@/lib/lyrics/line-utils'
import { lyricGlowAt } from '@/lib/lyrics/lyric-glow'
import { detectClientSongDisplayLang, toggleLyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import { trainOf } from '@/lib/lyrics/rhythm/model'
import { basePeriodOf, getRhythmParams } from '@/lib/lyrics/rhythm/params'
import { rhythmModelFor, subscribeRhythm } from '@/lib/lyrics/rhythm/source'
import { rubyText } from '@/lib/lyrics/ruby-layout'
import { formatDisplayArtists, formatInlineSongTitle, formatTitleAliases } from '@/lib/lyrics/song-meta-format'
import { buildTimeline, getLineTextAt } from '@/lib/lyrics/timeline'
import { formatMusicCoverUrl } from '@/utils/common/image'

// 与 components/layout/topbar-island/music-island.tsx 完全一致的时间常量
const PEEK_MS = 1500
const PAUSE_SETTLE_MS = 350
const CLOCK_SYNC_HEARTBEAT_MS = 2500
const DESKTOP_ISLAND_PAIRED_KEY = 'neo-blog:desktop-island-paired'

function consumeIslandHandoffFlag(): boolean {
  if (typeof window === 'undefined')
    return false
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('island_handoff') !== '1')
      return false
    url.searchParams.delete('island_handoff')
    const nextSearch = url.searchParams.toString()
    const cleanHref = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`
    window.history.replaceState(window.history.state, '', cleanHref)
    return true
  }
  catch {
    return false
  }
}

function readDesktopIslandPairedFlag(): boolean {
  if (typeof window === 'undefined')
    return false
  try {
    return window.localStorage.getItem(DESKTOP_ISLAND_PAIRED_KEY) === '1'
  }
  catch {
    return false
  }
}

function writeDesktopIslandPairedFlag(paired: boolean) {
  if (typeof window === 'undefined')
    return
  try {
    if (paired)
      window.localStorage.setItem(DESKTOP_ISLAND_PAIRED_KEY, '1')
    else
      window.localStorage.removeItem(DESKTOP_ISLAND_PAIRED_KEY)
  }
  catch {
  }
}

const noopSubscribe = () => () => {}
const falseSnapshot = () => false
const emptySnapshot = () => ''
const nullRhythmSnapshot = () => null

function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return `tab_${crypto.randomUUID().slice(0, 8)}`
  return `tab_${Math.random().toString(36).slice(2, 10)}`
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined')
    return false
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  if (uaData?.platform)
    return /mac/i.test(uaData.platform)
  return /Macintosh|Mac OS X/i.test(navigator.userAgent) && !/Mobile|iPad|iPhone/i.test(navigator.userAgent)
}

function toAbsoluteCoverUrl(raw?: string, size = 240): string | null {
  if (!raw)
    return null
  const formatted = formatMusicCoverUrl(raw, size)
  if (!formatted)
    return null
  if (formatted.startsWith('http://') || formatted.startsWith('https://'))
    return formatted
  if (typeof window !== 'undefined') {
    try {
      return new URL(formatted, window.location.origin).href
    }
    catch {
      return null
    }
  }
  return formatted
}

/** 1:1 对齐 lyric-player.ts resolveGroupColors：仅在曲目存在歌手标注表（agents）且当前行标有 agent 时返回色条颜色数组 */
function resolveLineEdgeColors(
  agentId: string | undefined,
  agents: Record<string, LyricAgent> | undefined,
  soloAgents: LyricAgent[],
): string[] | null {
  if (!agentId || !agents)
    return null
  const agent = agents[agentId]
  if (!agent)
    return null
  if (agent.isGroup) {
    const seenIds = new Set<string>()
    const memberHexes: string[] = []
    for (const id of agent.members ?? []) {
      if (seenIds.has(id))
        continue
      seenIds.add(id)
      const member = agents[id]
      if (member)
        memberHexes.push(resolveAgentHex(member))
    }
    if (memberHexes.length >= 2)
      return memberHexes.slice(0, 6)
    const c1 = soloAgents[0] ? resolveAgentHex(soloAgents[0]) : resolveAgentHex(agent)
    const c2 = soloAgents[1] ? resolveAgentHex(soloAgents[1]) : resolveAgentHex(agent)
    return [c1, c2]
  }
  return [resolveAgentHex(agent)]
}

function serializeLyrics(lyrics: ResolvedLyrics) {
  const owners = getBackgroundOwnerMap(lyrics.lines)
  const timeline = buildTimeline(lyrics.lines)
  const interludes = timeline
    .filter((item): item is { kind: 'interlude', start: number, end: number } => item.kind === 'interlude')
    .map(item => ({ start: item.start, end: item.end }))
  const soloAgents = lyrics.agents ? Object.values(lyrics.agents).filter(a => !a.isGroup) : []
  const soloCount = soloAgents.length

  const lines = lyrics.lines.map((line, index) => {
    const ownerLine = line.isBackground ? owners.get(index) : undefined
    const resolvedAlign = line.isBackground && line.align == null && !line.isDuet && ownerLine != null && lyrics.lines[ownerLine]
      ? getLyricLineAlign(lyrics.lines[ownerLine])
      : getLyricLineAlign(line)
    const agent = line.agent && lyrics.agents ? lyrics.agents[line.agent] : undefined
    let singerName: string | null = null
    let singerDotOnly = false
    if (!line.isBackground && agent) {
      if (agent.name) {
        singerName = agent.name
      }
      else if (agent.isGroup && lyrics.agents) {
        const members = agent.members ?? []
        singerName = members.length >= 2 && members.every(id => Boolean(lyrics.agents?.[id]?.name))
          ? members.map(id => lyrics.agents![id]!.name!).join(' · ')
          : '合唱'
      }
      else if (soloCount > 2) {
        singerDotOnly = true
      }
    }
    const romanizationWords = (line.romanizationWords ?? [])
      .map(rw => ({
        text: rubyText(rw.text),
        start: rw.start,
        end: rw.end,
        word: rw.word,
      }))
      .filter(rw => rw.text.length > 0)

    return {
      start: line.start,
      end: line.end,
      is_duet: line.isDuet,
      is_background: line.isBackground,
      align: resolvedAlign,
      owner: owners.get(index) ?? -1,
      paragraph_start: Boolean(line.paragraphStart),
      background_position: line.backgroundPosition ?? null,
      chorus_start: Boolean(line.chorusStart),
      edge_colors: resolveLineEdgeColors(line.agent, lyrics.agents, soloAgents),
      singer_name: singerName,
      singer_dot_only: singerDotOnly,
      translation: line.translation ?? null,
      secondary_translation: line.secondaryTranslation ?? null,
      romanization: line.romanization ?? null,
      romanization_words: romanizationWords,
      mood_hex: line.mood ? MOOD_GLOW[line.mood] : null,
      scene: !line.isBackground ? (line.scene ?? null) : null,
      scene_color_hex: !line.isBackground && line.sceneColor ? LYRIC_COLORS[line.sceneColor] : null,
      scene_lines: !line.isBackground ? (line.sceneLines ?? null) : null,
      words: line.words.map(w => ({
        text: w.text,
        start: w.start,
        end: w.end,
        ...(w.ruby && w.ruby.length > 0
          ? { ruby: w.ruby.map(r => ({ text: r.text, start: r.start, end: r.end })) }
          : {}),
      })),
      emphasis: (line.emphasis ?? []).map(group => ({
        from: group.from,
        to: group.to,
        start: group.start,
        end: group.end,
        factor: group.factor,
        effect: group.effect,
        color_hex: group.color ? LYRIC_COLORS[group.color] : null,
        font: group.font ?? null,
        styles: group.styles ?? [],
        hold: group.hold ?? null,
      })),
    }
  })

  const sprites = lyrics.sprites
    ? Object.fromEntries(
        Object.entries(lyrics.sprites).map(([key, sp]) => [
          key,
          {
            name: sp.name,
            paths: sp.paths.map(p => ({ d: p.d, paint: p.paint })),
            motion: sp.motion,
            size: sp.size,
            spin: Boolean(sp.spin),
            color_hex: LYRIC_COLORS[sp.color],
          },
        ]),
      )
    : {}

  return {
    source: lyrics.source,
    source_name: lyrics.sourceName ?? null,
    font: lyrics.font ?? null,
    motion: lyrics.motion ?? null,
    word_synced: lyrics.wordTimed,
    instrumental: Boolean(lyrics.instrumental),
    spotlights: lyrics.spotlights ?? [],
    sprites,
    intro: lyrics.intro ?? null,
    outro: lyrics.outro ?? null,
    notes: (lyrics.notes ?? []).map(n => ({
      start: n.start,
      content: n.content,
      source: n.source,
      liked: n.liked ?? null,
    })),
    interludes,
    lines,
  }
}

function serializeRhythm(model: RhythmModel | null) {
  if (!model || !model.reliable) {
    return {
      reliable: false,
      base_period_ms: 750,
      trains: {},
    }
  }
  const params = getRhythmParams()
  const compactTrain = (oct: number) =>
    trainOf(model, oct).map(p => [Math.round(p.t * 10) / 10, Math.round(p.a * 1000) / 1000] as const)

  return {
    reliable: true,
    base_period_ms: basePeriodOf(model.analysis.basePeriodMs, params),
    trains: {
      '-1': compactTrain(-1),
      '0': compactTrain(0),
      '1': compactTrain(1),
      '2': compactTrain(2),
    },
  }
}

interface IncomingIslandCommand {
  action: string
  position_ms?: number
  index?: number
  play_mode?: PlayMode
  volume?: number
  muted?: boolean
  track_id?: number
  is_playing?: boolean
  force?: boolean
  hdr?: boolean
  preferences?: {
    show_translation?: boolean
    show_romaji?: boolean
    show_lyric_effects?: boolean
    show_lyric_moments?: boolean
    translation_selections?: Array<{ lang: string, prefer_native?: boolean }>
  }
  lang?: string
  prefer_native?: boolean
  has_dual_sources?: boolean
  focus_token?: string
}

let cleanupFocusStamp: (() => void) | null = null

/**
 * 为当前正在播放音乐的标签页临时打上一次性聚焦标记，供 macOS 原生端 Apple Events 在多窗口/多标签页中 100% 唯一命中该 Tab：
 * - 通过 MutationObserver 跨越 Next.js 切往 /music 期间的异步 <title> 重写；
 * - 窗口切回前台获得焦点后立即无痕擦除标记（最长保留 10s，留足首次 macOS 系统授权弹窗点击时间）。
 */
function stampDocumentTitleForFocus(token: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !token)
    return
  cleanupFocusStamp?.()
  const marker = ` [${token}]`
  const applyStamp = () => {
    if (!document.title.includes(marker))
      document.title = `${document.title}${marker}`
  }
  const stripStamp = () => {
    if (document.title.includes(marker))
      document.title = document.title.split(marker).join('')
  }
  applyStamp()

  let applying = false
  const observer = new MutationObserver(() => {
    if (applying)
      return
    if (!document.title.includes(marker)) {
      applying = true
      applyStamp()
      applying = false
    }
  })
  if (document.head)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })

  let timer = 0
  const listenerCtrl = new AbortController()
  const teardown = () => {
    window.clearTimeout(timer)
    listenerCtrl.abort()
    observer.disconnect()
    stripStamp()
    if (cleanupFocusStamp === teardown)
      cleanupFocusStamp = null
  }
  const onActivated = () => {
    window.setTimeout(teardown, 150)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && document.hasFocus())
      onActivated()
  }
  window.addEventListener('focus', onActivated, { once: true, signal: listenerCtrl.signal })
  document.addEventListener('visibilitychange', onVisibility, { signal: listenerCtrl.signal })
  timer = window.setTimeout(teardown, 10000)
  cleanupFocusStamp = teardown
}

/**
 * 网页播放器 ↔ 本地 macOS 系统灵动岛桥接组件：
 * - 浏览器在线时由网页 `<audio>` 驱动发声，macOS 灵动岛负责原生显示、跨 Mac AWDL 流转与反向遥控；
 * - 浏览器关闭断联后由 macOS 灵动岛无缝接续内置音频播放（跨屏单岛流转「声随岛走」、双屏同显「原源主机播放」），浏览器重连起播时原子交回发声权；
 * - 完整推送逐字时间轴、多声部对齐与歌手色条、7 套字体标识、全部 9 种 AI 强调特效参数、消散/破碎跳转锚点及音频真实节拍脉冲列。
 *
 * 【双端同步维护约定】
 * 每当网页音乐灵动岛（`components/layout/topbar-island/music-island*.tsx` / `mini-player.tsx`）或
 * macOS 原生灵动岛（`macos-island/Sources/NeoBlogIsland/`）新增 feature 时，必须在两端同步实现，
 * 并在此文件与 `IslandModels.swift` 中同步扩展协议字段或遥控指令（时间字段统一以 `_ms` 毫秒命名）。
 */
export function DesktopIslandBridge() {
  const prefs = useDesktopIslandPrefs()
  const { reconnectEpoch } = useDesktopIslandRuntime()
  const router = useRouter()
  const pathname = usePathname()

  const {
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration: playbackDurationSec,
    playlistComplete,
    pendingStep,
    adjacentTracks,
  } = useMusicPlayback()
  const {
    lyrics,
    lyricLines,
    lyricStatus,
    lyricSourcesPending,
    refreshLyrics,
    canToggleTranslation,
    lyricTranslationsGenerating,
    songLang,
    availableTranslationLangs,
    canToggleRomaji,
    lyricPronunciationsGenerating,
  } = useMusicLyrics()
  const { volume, isMuted } = useMusicVolume()
  const {
    showTranslation,
    translationLang,
    preferNativeTranslation,
    translationSelections,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
  } = useMusicPreferences()
  const actions = useMusicActions()
  const clock = useMusicClockStore()

  // 与 music-island.tsx 一致：本页播放过才在暂停后保留（反向接管缓冲/Autoplay 探测期间暂缓置位，避免拦截失败残留）
  const [hasPlayed, setHasPlayed] = useState(false)
  const [pendingPassiveAdoptEpoch, setPendingPassiveAdoptEpoch] = useState(0)

  const [handoffRequested] = useState(() => consumeIslandHandoffFlag())
  const handoffRequestedRef = useRef(handoffRequested)
  const adoptingStateRef = useRef<{ trackId: number, targetSec: number, pausedAdopt: boolean } | null>(null)
  const adoptedPosFallbackSecRef = useRef<{ trackId: number, sec: number } | null>(null)
  const pendingAdoptedNotifyRef = useRef(false)
  const pendingPassiveAdoptRef = useRef(false)
  const passiveAdoptRequestHoldUntilRef = useRef<number>(0)
  const passiveGestureTimerRef = useRef<number>(0)
  const isPlayingRefForAdopt = useRef(isPlaying)
  isPlayingRefForAdopt.current = isPlaying
  const syncedPreferencesPendingRef = useRef<{
    trackId: number
    preferences: NonNullable<IncomingIslandCommand['preferences']>
  } | null>(null)
  const adoptAttemptSeqRef = useRef(0)

  const isAdoptHoldActive = () => Boolean(
    adoptingStateRef.current || performance.now() < passiveAdoptRequestHoldUntilRef.current,
  )

  if (isPlaying && !hasPlayed && !isAdoptHoldActive())
    setHasPlayed(true)

  const [pauseSettled, setPauseSettled] = useState(false)
  useEffect(() => {
    if (isPlaying) {
      setPauseSettled(false)
      return
    }
    const timer = window.setTimeout(setPauseSettled, PAUSE_SETTLE_MS, true)
    return () => window.clearTimeout(timer)
  }, [isPlaying])

  const showPlaying = isPlaying || (hasPlayed && !pauseSettled)

  const accent = useSongAccent(currentTrack?.albumPic)
  const chorus = useSongChorus(currentTrack?.id ?? null)
  const meta = useCachedSongMetaTranslation(currentTrack?.id ?? null)

  const formatLangLabel = useLanguageLabel()

  const activeTranslationSelections = useMemo<LyricTranslationSelection[]>(() => {
    if (translationSelections !== undefined)
      return translationSelections
    return translationLang ? [{ lang: translationLang, preferNative: Boolean(preferNativeTranslation) }] : []
  }, [preferNativeTranslation, translationLang, translationSelections])

  const songLangLabel = useMemo(() => {
    const code = songLang !== undefined ? songLang : detectClientSongDisplayLang(lyrics)
    return code ? formatLangLabel(code) : ''
  }, [formatLangLabel, lyrics, songLang])

  const availableLangItems = useMemo(() => {
    return (availableTranslationLangs ?? [])
      .filter(item => item.hasAi || item.hasNative || item.generating)
      .map(item => ({
        lang: item.lang,
        label: formatLangLabel(item.lang),
        has_ai: Boolean(item.hasAi),
        has_native: Boolean(item.hasNative),
        generating: Boolean(item.generating),
      }))
  }, [availableTranslationLangs, formatLangLabel])

  // 订阅当前曲目的音频节拍模型（分析完成后自动推送给桌面灵动岛）
  const trackId = currentTrack?.id ?? null
  const getRhythmSnapshot = useCallback(() => rhythmModelFor(trackId), [trackId])
  const rhythmModel = useSyncExternalStore(subscribeRhythm, getRhythmSnapshot, nullRhythmSnapshot)

  // 最近一次跳转落点（供消散 / 破碎判断在落点之前就该碎的词直接正常显示，对齐 lyric-player.ts 的 seekAt）
  const seekAtRef = useRef<number>(Number.NEGATIVE_INFINITY)
  useEffect(() => {
    seekAtRef.current = Number.NEGATIVE_INFINITY
  }, [trackId])

  // 首句是否已开唱（前奏期间为 false）
  const getLyricStarted = useCallback(
    () => lyricLines.length > 0 && clock.getSnapshot() * 1000 >= getLyricLineVocalStart(lyricLines[0]),
    [clock, lyricLines],
  )
  const lyricStarted = useSyncExternalStore(
    isPlaying ? clock.subscribe : noopSubscribe,
    isPlaying ? getLyricStarted : falseSnapshot,
    falseSnapshot,
  )

  // 暂停时胶囊内静态显示的那一句歌词（间奏、开唱前或无歌词时为 null，回退歌名）
  const timelineItems = useMemo(() => buildTimeline(lyrics.lines), [lyrics.lines])
  const getPausedLine = useCallback(
    () => getLineTextAt(lyrics.lines, timelineItems, clock.getSnapshot() * 1000) ?? '',
    [clock, lyrics.lines, timelineItems],
  )
  const pausedLine = useSyncExternalStore(
    !showPlaying && hasPlayed ? clock.subscribe : noopSubscribe,
    !showPlaying && hasPlayed ? getPausedLine : emptySnapshot,
    emptySnapshot,
  ) || null

  // 是否处于副歌区间 + 实时歌词辉光颜色（与 music-island.tsx 的 useInChorus + useLyricGlow 一致）
  const getInChorus = useCallback(() => {
    const ms = clock.getSnapshot() * 1000
    return chorus.some(item => ms >= item.start && ms < item.end)
  }, [chorus, clock])
  const inChorus = useSyncExternalStore(
    isPlaying && prefs.chorusGlow && currentTrack ? clock.subscribe : noopSubscribe,
    isPlaying && prefs.chorusGlow && currentTrack ? getInChorus : falseSnapshot,
    falseSnapshot,
  )

  const getGlowKey = useCallback(() => {
    const { color, strong } = lyricGlowAt(lyrics, clock.getSnapshot() * 1000)
    return `${color ?? ''}|${strong ? 1 : 0}`
  }, [clock, lyrics])
  const glowKey = useSyncExternalStore(
    inChorus ? clock.subscribe : noopSubscribe,
    inChorus ? getGlowKey : emptySnapshot,
    emptySnapshot,
  )
  const glow = useMemo(() => {
    if (!inChorus || !prefs.chorusGlow)
      return null
    const [color, strong] = glowKey.split('|')
    return {
      color: color || accent || '#60a5fa',
      strong: strong === '1',
    }
  }, [accent, glowKey, inChorus, prefs.chorusGlow])

  // 切歌前奏短暂显示歌名（PEEK_MS = 1500ms），首句开唱立即让位给逐字歌词
  const [peekTrackId, setPeekTrackId] = useState<number | null>(null)
  const peekedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isPlaying || !currentTrack || !prefs.showTrackPeek || peekedRef.current === currentTrack.id)
      return
    peekedRef.current = currentTrack.id
    if (lyricStarted)
      return
    setPeekTrackId(currentTrack.id)
    const timer = window.setTimeout(() => {
      setPeekTrackId(prev => (prev === currentTrack.id ? null : prev))
    }, PEEK_MS)
    return () => window.clearTimeout(timer)
    // lyricStarted 不放进依赖：只在切歌或开始播放瞬间判断一次，开唱撤下由下方 effect 处理
  }, [currentTrack?.id, isPlaying, prefs.showTrackPeek])

  useEffect(() => {
    if (lyricStarted || !prefs.showTrackPeek)
      setPeekTrackId(null)
  }, [lyricStarted, prefs.showTrackPeek])

  const formattedTrack = useMemo(() => {
    if (!currentTrack)
      return null
    const titleExtra = formatTitleAliases(
      currentTrack.name,
      currentTrack.aliases,
      meta?.title,
      showTranslation,
      meta?.aliases,
    )
    const displayArtists = formatDisplayArtists(currentTrack.artists, meta?.artists, showTranslation)
    const inlineName = formatInlineSongTitle(
      currentTrack.name,
      [],
      meta?.title,
      showTranslation,
    )
    const inlineTitle = [inlineName, displayArtists.join(' / ')].filter(Boolean).join(' - ')
    return {
      id: currentTrack.id,
      name: currentTrack.name,
      title_extra: titleExtra || null,
      artists: currentTrack.artists,
      display_artists: displayArtists,
      inline_title: inlineTitle,
      album: currentTrack.album,
      album_pic: toAbsoluteCoverUrl(currentTrack.albumPic, 240),
      duration_ms: currentTrack.duration ?? 0,
    }
  }, [currentTrack, meta?.aliases, meta?.artists, meta?.title, showTranslation])

  const tabIdRef = useRef<string>('')
  if (!tabIdRef.current)
    tabIdRef.current = createTabId()

  const currentIndexRefForAdopt = useRef<number | null>(currentIndex)
  currentIndexRefForAdopt.current = currentIndex
  const wsRef = useRef<WebSocket | null>(null)
  const pageHiddenUnloadRef = useRef(false)
  const unloadGuardUntilRef = useRef(0)
  const [wsOpenEpoch, setWsOpenEpoch] = useState(0)

  const sendJSON = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return
    try {
      ws.send(JSON.stringify({
        v: 2,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        ...payload,
      }))
    }
    catch {
      // 忽略关闭瞬间的写入异常
    }
  }, [])

  const commandContextRef = useRef({
    actions,
    refreshLyrics,
    router,
    pathname,
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    desktopHdr: prefs.hdr,
    activeTranslationSelections,
    playlist,
    isMuted,
  })
  commandContextRef.current = {
    actions,
    refreshLyrics,
    router,
    pathname,
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    desktopHdr: prefs.hdr,
    activeTranslationSelections,
    playlist,
    isMuted,
  }

  const handleIncomingCommand = useCallback((cmd: IncomingIslandCommand) => {
    const ctx = commandContextRef.current
    switch (cmd.action) {
      case 'play':
        ctx.actions.play()
        break
      case 'pause':
        ctx.actions.pause()
        break
      case 'toggle':
        ctx.actions.togglePlay()
        break
      case 'next':
        ctx.actions.next()
        break
      case 'prev':
        ctx.actions.prev()
        break
      case 'seek':
        if (typeof cmd.position_ms === 'number' && Number.isFinite(cmd.position_ms)) {
          seekAtRef.current = cmd.position_ms
          ctx.actions.seek(Math.max(0, cmd.position_ms / 1000))
        }
        break
      case 'play_track':
        if (typeof cmd.index === 'number' && Number.isInteger(cmd.index) && cmd.index >= 0) {
          void ctx.actions.ensurePlaylist().then(() => {
            ctx.actions.playTrack(cmd.index!)
          })
        }
        break
      case 'set_mode':
        if (cmd.play_mode === 'repeat-all' || cmd.play_mode === 'repeat-one' || cmd.play_mode === 'shuffle')
          ctx.actions.setPlayMode(cmd.play_mode)
        break
      case 'set_volume':
        if (typeof cmd.volume === 'number' && Number.isFinite(cmd.volume))
          ctx.actions.setVolume(Math.max(0, Math.min(1, cmd.volume)))
        break
      case 'toggle_muted':
        ctx.actions.toggleMuted()
        break
      case 'toggle_translation':
        ctx.actions.setShowTranslation(!ctx.showTranslation)
        break
      case 'toggle_romaji':
        ctx.actions.setShowRomaji(!ctx.showRomaji)
        break
      case 'toggle_effects':
        ctx.actions.setShowLyricEffects(!ctx.showLyricEffects)
        break
      case 'toggle_moments':
        ctx.actions.setShowLyricMoments(!ctx.showLyricMoments)
        break
      case 'toggle_hdr': {
        const nextHdr = !ctx.desktopHdr
        updateDesktopIslandPrefs({ hdr: nextHdr })
        ctx.actions.setHdr(nextHdr)
        break
      }
      case 'reset_translation_langs':
        ctx.actions.setTranslationSelections([])
        ctx.actions.setShowTranslation(true)
        break
      case 'toggle_translation_lang':
        if (typeof cmd.lang === 'string' && cmd.lang) {
          const next = toggleLyricTranslationSelection(
            ctx.activeTranslationSelections,
            { lang: cmd.lang as LyricTargetLang, preferNative: Boolean(cmd.prefer_native) },
            { hasDualSources: Boolean(cmd.has_dual_sources) },
          )
          ctx.actions.setTranslationSelections(next)
          ctx.actions.setShowTranslation(true)
        }
        break
      case 'ensure_playlist':
        void ctx.actions.ensurePlaylist()
        break
      case 'refresh_lyrics':
        ctx.refreshLyrics()
        break
      case 'open_player_page': {
        const token = typeof cmd.focus_token === 'string' ? cmd.focus_token : ''
        if (token)
          stampDocumentTitleForFocus(token)
        if (ctx.pathname !== '/music')
          ctx.router.push('/music')
        if (token) {
          sendJSON({
            type: 'focus_ready',
            tab_id: tabIdRef.current,
            focus_token: token,
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          })
        }
        window.focus()
        break
      }
      case 'sync_snapshot':
        setWsOpenEpoch(n => (n > 0 ? n + 1 : 1))
        break
      case 'adopt_native_session': {
        const targetTrackId = typeof cmd.track_id === 'number' && Number.isInteger(cmd.track_id) ? cmd.track_id : null
        if (targetTrackId == null)
          break

        const shouldPlay = cmd.is_playing !== false
        const explicitHandoff = Boolean(cmd.force) || handoffRequestedRef.current
        const userAct = typeof navigator !== 'undefined'
          ? (navigator as Navigator & { userActivation?: { isActive?: boolean, hasBeenActive?: boolean } }).userActivation
          : undefined
        const hasUserActivation = Boolean(userAct?.isActive || userAct?.hasBeenActive)

        // 被动新开普通页面且无用户手势（或内置续播处于暂停态且非主动唤起）时，不提前改写网页歌单与进度，标记待交互进入 /music 时按需重拉最新状态
        if ((!shouldPlay && !explicitHandoff) || (shouldPlay && !explicitHandoff && !hasUserActivation)) {
          pendingPassiveAdoptRef.current = true
          setPendingPassiveAdoptEpoch(n => n + 1)
          break
        }
        passiveAdoptRequestHoldUntilRef.current = 0
        handoffRequestedRef.current = false
        pendingPassiveAdoptRef.current = false

        const applyLyricBucketPreferences = (prefsToApply: NonNullable<IncomingIslandCommand['preferences']>) => {
          const latestCtx = commandContextRef.current
          if (typeof prefsToApply.show_translation === 'boolean')
            latestCtx.actions.setShowTranslation(prefsToApply.show_translation)
          if (typeof prefsToApply.show_romaji === 'boolean')
            latestCtx.actions.setShowRomaji(prefsToApply.show_romaji)
          if (typeof prefsToApply.show_lyric_effects === 'boolean')
            latestCtx.actions.setShowLyricEffects(prefsToApply.show_lyric_effects)
          if (typeof prefsToApply.show_lyric_moments === 'boolean')
            latestCtx.actions.setShowLyricMoments(prefsToApply.show_lyric_moments)
          if (Array.isArray(prefsToApply.translation_selections)) {
            latestCtx.actions.setTranslationSelections(
              prefsToApply.translation_selections
                .filter(item => typeof item?.lang === 'string' && item.lang.length > 0)
                .map(item => ({ lang: item.lang as LyricTargetLang, preferNative: Boolean(item.prefer_native) })),
            )
          }
        }

        const applySyncedPreferences = () => {
          const latestCtx = commandContextRef.current
          if (cmd.play_mode === 'repeat-all' || cmd.play_mode === 'repeat-one' || cmd.play_mode === 'shuffle')
            latestCtx.actions.setPlayMode(cmd.play_mode)
          if (typeof cmd.volume === 'number' && Number.isFinite(cmd.volume))
            latestCtx.actions.setVolume(Math.max(0, Math.min(1, cmd.volume)))
          if (typeof cmd.muted === 'boolean' && cmd.muted !== latestCtx.isMuted)
            latestCtx.actions.toggleMuted()
          if (typeof cmd.hdr === 'boolean' && cmd.hdr !== latestCtx.desktopHdr) {
            updateDesktopIslandPrefs({ hdr: cmd.hdr })
            latestCtx.actions.setHdr(cmd.hdr)
          }
          if (cmd.preferences) {
            syncedPreferencesPendingRef.current = { trackId: targetTrackId, preferences: cmd.preferences }
            applyLyricBucketPreferences(cmd.preferences)
          }
        }

        const basePosMs = typeof cmd.position_ms === 'number' && Number.isFinite(cmd.position_ms)
          ? Math.max(0, cmd.position_ms)
          : 0
        const adoptStartAt = performance.now()
        const attemptSeq = ++adoptAttemptSeqRef.current

        void (async () => {
          let list = commandContextRef.current.playlist
          let idx = list.findIndex(item => item.id === targetTrackId)
          if (idx < 0) {
            await commandContextRef.current.actions.ensurePlaylist()
            if (adoptAttemptSeqRef.current !== attemptSeq)
              return
            list = commandContextRef.current.playlist
            idx = list.findIndex(item => item.id === targetTrackId)
          }

          let singleTrack: MusicTrack | null = null
          if (idx < 0) {
            singleTrack = await fetchPlaylistTrack([targetTrackId]).catch(() => null)
            if (adoptAttemptSeqRef.current !== attemptSeq)
              return
          }

          const latestActions = commandContextRef.current.actions
          const latestList = commandContextRef.current.playlist
          const latestIdx = latestList.findIndex(item => item.id === targetTrackId)
          if (latestIdx < 0 && !singleTrack)
            return

          applySyncedPreferences()

          const elapsedSec = shouldPlay ? Math.max(0, (performance.now() - adoptStartAt) / 1000) : 0
          const targetSec = basePosMs / 1000 + elapsedSec
          seekAtRef.current = targetSec * 1000
          adoptedPosFallbackSecRef.current = { trackId: targetTrackId, sec: targetSec }

          if (!shouldPlay) {
            adoptingStateRef.current = { trackId: targetTrackId, targetSec, pausedAdopt: true }
            if (latestIdx >= 0)
              latestActions.replacePlaylist(latestList, latestIdx, targetSec)
            else if (singleTrack)
              latestActions.replacePlaylist([singleTrack], 0, targetSec)
            setHasPlayed(true)
            return
          }

          // 起播缓冲期间挂起网页端中间态广播，严防 HTML5 'play' 事件在缓冲/鉴权或 Autoplay 拒绝前误杀灵动岛内置播放
          adoptingStateRef.current = { trackId: targetTrackId, targetSec, pausedAdopt: false }
          const prevPlaylistSnapshot = latestList
          const prevIdxSnapshot = currentIndexRefForAdopt.current

          const audio = latestActions.getAudio()
          let settled = false
          let safariCheckTimer = 0
          let cleanupTimer = 0

          const teardownListeners = () => {
            window.clearTimeout(safariCheckTimer)
            window.clearTimeout(cleanupTimer)
            audio?.removeEventListener('playing', onAudioPlaying)
            audio?.removeEventListener('pause', onAutoplayRejectedOrPaused)
            audio?.removeEventListener('error', onAutoplayRejectedOrPaused)
          }

          function onAudioPlaying() {
            if (settled || adoptAttemptSeqRef.current !== attemptSeq)
              return
            settled = true
            teardownListeners()
            if (audio && audio.readyState >= 1 && Math.abs(audio.currentTime - targetSec) > 1.8) {
              try {
                audio.currentTime = Math.max(0, Math.min(targetSec, audio.duration || targetSec))
              }
              catch {}
            }
            adoptingStateRef.current = null
            adoptedPosFallbackSecRef.current = null
            pendingAdoptedNotifyRef.current = true
            setHasPlayed(true)
            setWsOpenEpoch(n => (n > 0 ? n + 1 : 1))
          }

          function onAutoplayRejectedOrPaused() {
            if (settled || adoptAttemptSeqRef.current !== attemptSeq)
              return
            // 若尚未真正进入 playing 即收到 pause/error 或 Safari 静默保持 paused（Autoplay Policy 拦截），
            // 释放挂起锁并登记首次点击重拉最新进度；若本页此前已播过其他曲目则恢复先前索引，否则保持 hasPlayed=false 不惊动灵动岛
            if (!audio || (audio.readyState < 3 && audio.paused)) {
              settled = true
              teardownListeners()
              adoptingStateRef.current = null
              adoptedPosFallbackSecRef.current = null
              syncedPreferencesPendingRef.current = null
              pendingPassiveAdoptRef.current = true
              setPendingPassiveAdoptEpoch(n => n + 1)
              if (prevIdxSnapshot != null && prevIdxSnapshot >= 0 && prevPlaylistSnapshot[prevIdxSnapshot])
                latestActions.replacePlaylist(prevPlaylistSnapshot, prevIdxSnapshot)
            }
          }

          if (audio) {
            audio.addEventListener('playing', onAudioPlaying)
            audio.addEventListener('pause', onAutoplayRejectedOrPaused)
            audio.addEventListener('error', onAutoplayRejectedOrPaused)
            // 兼容 macOS Safari 无手势拒绝 play() 时不派发 pause/error 事件、仅维持 audio.paused=true 的静默拦截（慢网正常缓冲时 audio.paused 为 false，不受影响）
            safariCheckTimer = window.setTimeout(() => {
              if (!settled && audio.paused)
                onAutoplayRejectedOrPaused()
            }, 260)
            cleanupTimer = window.setTimeout(() => {
              if (settled)
                return
              settled = true
              teardownListeners()
              adoptingStateRef.current = null
              adoptedPosFallbackSecRef.current = null
              syncedPreferencesPendingRef.current = null
              pendingPassiveAdoptRef.current = true
              setPendingPassiveAdoptEpoch(n => n + 1)
            }, 4500)
          }

          if (latestIdx >= 0)
            latestActions.playTrack(latestIdx, targetSec)
          else if (singleTrack)
            latestActions.playSong(singleTrack, targetSec)
        })()
        break
      }
    }
  }, [sendJSON])

  // 建立并维护本地 ws://127.0.0.1:<port>/ws 长连接：
  // 1. 仅在本页首次开始播放音乐（hasPlayed）、设置页手动重连（reconnectEpoch > 0）、从灵动岛唤起接续（?island_handoff=1）或本机曾配对连上过客户端时激活；普通未安装访客进站绝不提前请求 localhost；
  // 2. 非 macOS 设备除非手动触发重连，否则保持静默待命；
  // 3. 首次连接通过异步延迟脱离 <audio>.play() 关键路径，绝不阻塞音乐起播；未安装本地客户端时最多轻量重试 2 次即静默休眠并清除历史标记。
  useEffect(() => {
    if (!prefs.enabled) {
      setDesktopIslandRuntimeStatus('disabled')
      return
    }

    const manualTrigger = reconnectEpoch > 0 || handoffRequested
    const pairedWithIsland = readDesktopIslandPairedFlag()
    if (!hasPlayed && !manualTrigger && !pairedWithIsland) {
      setDesktopIslandRuntimeStatus('standby')
      return
    }

    if (!isMacPlatform() && !manualTrigger) {
      setDesktopIslandRuntimeStatus('standby')
      return
    }

    let disposed = false
    let everConnected = false
    let retryAttempt = 0
    let retryTimer = 0
    let initialTimer = 0

    const connect = () => {
      if (disposed || pageHiddenUnloadRef.current)
        return
      const existing = wsRef.current
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN))
        return
      window.clearTimeout(retryTimer)
      setDesktopIslandRuntimeStatus('connecting')

      let socket: WebSocket
      try {
        const url = `ws://127.0.0.1:${prefs.port}/ws?tab_id=${encodeURIComponent(tabIdRef.current)}`
        socket = new WebSocket(url)
      }
      catch {
        setDesktopIslandRuntimeStatus('disconnected')
        return
      }

      wsRef.current = socket

      socket.onopen = () => {
        if (disposed || pageHiddenUnloadRef.current) {
          socket.close()
          return
        }
        everConnected = true
        retryAttempt = 0
        writeDesktopIslandPairedFlag(true)
        setDesktopIslandRuntimeStatus('connected')
        setWsOpenEpoch(n => n + 1)
      }

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string')
          return
        try {
          const parsed = JSON.parse(event.data) as { type?: string, command?: IncomingIslandCommand }
          if (parsed.type === 'command' && parsed.command)
            handleIncomingCommand(parsed.command)
        }
        catch {
          // 忽略格式非法的帧
        }
      }

      socket.onclose = () => {
        if (wsRef.current === socket)
          wsRef.current = null
        if (disposed || pageHiddenUnloadRef.current)
          return
        setDesktopIslandRuntimeStatus('disconnected')
        // 若本机未连上桌面灵动岛（用户未安装/未打开客户端），仅做最多 2 次轻量探测即停止轮询，杜绝后台刷屏与干扰
        if (!everConnected && retryAttempt >= 2) {
          if (!hasPlayed && !manualTrigger)
            writeDesktopIslandPairedFlag(false)
          return
        }
        const delay = everConnected
          ? Math.min(8000, 1000 * 2 ** Math.min(3, retryAttempt))
          : (retryAttempt === 0 ? 2000 : 5000)
        retryAttempt += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => {}
    }

    // 让出首帧音频缓冲与 UI 渲染，异步发起本地回环握手，100% 不阻塞音乐起播
    const initialDelay = manualTrigger ? 0 : (hasPlayed ? 160 : 320)
    initialTimer = window.setTimeout(connect, initialDelay)

    // 捕获阶段提前拦截页面卸载：关闭标签页/刷新/退出浏览器时，防止 <audio> 销毁瞬间的 'pause' 事件抢先在 WS 关闭前发出 is_playing:false
    const onBeforeUnload = () => {
      unloadGuardUntilRef.current = performance.now() + 1200
    }
    const clearAbortedBeforeUnload = () => {
      if (!pageHiddenUnloadRef.current && unloadGuardUntilRef.current > 0)
        unloadGuardUntilRef.current = 0
    }
    const onPageHide = () => {
      pageHiddenUnloadRef.current = true
      unloadGuardUntilRef.current = performance.now() + 5000
      window.clearTimeout(initialTimer)
      window.clearTimeout(retryTimer)
      const active = wsRef.current
      wsRef.current = null
      active?.close()
    }
    const onPageShow = () => {
      pageHiddenUnloadRef.current = false
      unloadGuardUntilRef.current = 0
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        retryAttempt = 0
        window.clearTimeout(initialTimer)
        window.clearTimeout(retryTimer)
        initialTimer = window.setTimeout(connect, 80)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearAbortedBeforeUnload()
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          retryAttempt = 0
          window.clearTimeout(initialTimer)
          window.clearTimeout(retryTimer)
          initialTimer = window.setTimeout(connect, 120)
        }
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload, true)
    window.addEventListener('pagehide', onPageHide, true)
    window.addEventListener('pageshow', onPageShow, true)
    window.addEventListener('focus', clearAbortedBeforeUnload)
    window.addEventListener('pointerdown', clearAbortedBeforeUnload, true)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      pageHiddenUnloadRef.current = false
      unloadGuardUntilRef.current = 0
      window.clearTimeout(initialTimer)
      window.clearTimeout(retryTimer)
      window.removeEventListener('beforeunload', onBeforeUnload, true)
      window.removeEventListener('pagehide', onPageHide, true)
      window.removeEventListener('pageshow', onPageShow, true)
      window.removeEventListener('focus', clearAbortedBeforeUnload)
      window.removeEventListener('pointerdown', clearAbortedBeforeUnload, true)
      document.removeEventListener('visibilitychange', onVisibility)
      const active = wsRef.current
      wsRef.current = null
      active?.close()
      setDesktopIslandRuntimeStatus(prefs.enabled ? 'standby' : 'disabled')
    }
  }, [handoffRequested, handleIncomingCommand, hasPlayed, prefs.enabled, prefs.port, reconnectEpoch])

  // 暂停态反向接管（!shouldPlay）：待 React 提交新曲目与 hasPlayed 后，置位通知标记并递增 wsOpenEpoch，确保先按序推齐 media/playlist/state 再发 native_session_adopted
  useEffect(() => {
    const pending = adoptingStateRef.current
    if (!pending || !pending.pausedAdopt)
      return
    if (!wsOpenEpoch || !hasPlayed || formattedTrack?.id !== pending.trackId)
      return
    adoptingStateRef.current = null
    pendingAdoptedNotifyRef.current = true
    setWsOpenEpoch(n => (n > 0 ? n + 1 : 1))
  }, [formattedTrack?.id, hasPlayed, wsOpenEpoch])

  // 目标曲目歌词就绪确定语种分桶后，补写一次接管同步过来的译/音开关与双语选择，防止切歌完成前落入默认桶被覆盖
  useEffect(() => {
    const pendingPref = syncedPreferencesPendingRef.current
    if (!pendingPref || currentTrack?.id !== pendingPref.trackId || lyricStatus === 'loading')
      return
    syncedPreferencesPendingRef.current = null
    const p = pendingPref.preferences
    if (typeof p.show_translation === 'boolean')
      actions.setShowTranslation(p.show_translation)
    if (typeof p.show_romaji === 'boolean')
      actions.setShowRomaji(p.show_romaji)
    if (Array.isArray(p.translation_selections)) {
      actions.setTranslationSelections(
        p.translation_selections
          .filter(item => typeof item?.lang === 'string' && item.lang.length > 0)
          .map(item => ({ lang: item.lang as LyricTargetLang, preferNative: Boolean(item.prefer_native) })),
      )
    }
  }, [actions, currentTrack?.id, lyricStatus])

  useEffect(() => {
    return () => {
      window.clearTimeout(passiveGestureTimerRef.current)
    }
  }, [])

  // 若首次被动打开同源页或无手势打开 /music?island_handoff=1 时因未交互跳过接管，待用户首次交互进入 /music（且网页自身尚未播歌）时主动拉取最新续播进度
  useEffect(() => {
    if (!wsOpenEpoch || hasPlayed || isPlaying)
      return
    if (pathname === '/music' && pendingPassiveAdoptRef.current) {
      const userAct = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { userActivation?: { isActive?: boolean, hasBeenActive?: boolean } }).userActivation
        : undefined
      if (userAct?.isActive || userAct?.hasBeenActive) {
        pendingPassiveAdoptRef.current = false
        passiveAdoptRequestHoldUntilRef.current = performance.now() + 600
        sendJSON({
          type: 'request_native_session',
          tab_id: tabIdRef.current,
          force: true,
        })
        return
      }

      let indexBeforeGesture = currentIndexRefForAdopt.current

      const onGestureStartCapture = () => {
        if (!pendingPassiveAdoptRef.current)
          return
        indexBeforeGesture = currentIndexRefForAdopt.current
        passiveAdoptRequestHoldUntilRef.current = performance.now() + 600
      }

      const onFirstGestureCommit = () => {
        if (!pendingPassiveAdoptRef.current)
          return
        pendingPassiveAdoptRef.current = false
        window.removeEventListener('pointerdown', onGestureStartCapture, true)
        window.removeEventListener('keydown', onGestureStartCapture, true)
        window.removeEventListener('click', onFirstGestureCommit)
        window.removeEventListener('keydown', onFirstGestureCommit)

        // 让出当前事件批处理（用组件级 ref 持有定时器，避免点击主播放键令 isPlaying 翻真时被当前 effect cleanup 误清）：
        // 若用户第一下点击就是在歌单中点选了另一首特定歌曲起播，则放行用户点歌；否则拉取灵动岛最新续播进度接力
        window.clearTimeout(passiveGestureTimerRef.current)
        passiveGestureTimerRef.current = window.setTimeout(() => {
          if (currentIndexRefForAdopt.current !== indexBeforeGesture && isPlayingRefForAdopt.current) {
            passiveAdoptRequestHoldUntilRef.current = 0
            setHasPlayed(true)
            setWsOpenEpoch(n => (n > 0 ? n + 1 : 1))
            return
          }
          passiveAdoptRequestHoldUntilRef.current = performance.now() + 600
          sendJSON({
            type: 'request_native_session',
            tab_id: tabIdRef.current,
            force: true,
          })
        }, 0)
      }

      window.addEventListener('pointerdown', onGestureStartCapture, true)
      window.addEventListener('keydown', onGestureStartCapture, true)
      window.addEventListener('click', onFirstGestureCommit)
      window.addEventListener('keydown', onFirstGestureCommit)
      return () => {
        window.removeEventListener('pointerdown', onGestureStartCapture, true)
        window.removeEventListener('keydown', onGestureStartCapture, true)
        window.removeEventListener('click', onFirstGestureCommit)
        window.removeEventListener('keydown', onFirstGestureCommit)
      }
    }
  }, [hasPlayed, isPlaying, pathname, pendingPassiveAdoptEpoch, sendJSON, wsOpenEpoch])

  // 1. 推送曲目与完整歌词结构
  useEffect(() => {
    if (!wsOpenEpoch || isAdoptHoldActive())
      return
    sendJSON({
      type: 'media',
      tab_id: tabIdRef.current,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      track: formattedTrack,
      accent_hex: accent ?? null,
      chorus,
      lyrics: serializeLyrics(lyrics),
    })
  }, [accent, chorus, formattedTrack, lyrics, sendJSON, wsOpenEpoch])

  // 2. 推送真实音频节拍脉冲列（供桌面灵动岛同步驱动律动条、背景呼吸染色与全部节拍卷积特效）
  useEffect(() => {
    if (!wsOpenEpoch || isAdoptHoldActive())
      return
    sendJSON({
      type: 'rhythm',
      tab_id: tabIdRef.current,
      track_id: trackId,
      rhythm: serializeRhythm(rhythmModel),
    })
  }, [rhythmModel, sendJSON, trackId, wsOpenEpoch])

  // 3. 推送歌单列表
  useEffect(() => {
    if (!wsOpenEpoch || isAdoptHoldActive())
      return
    sendJSON({
      type: 'playlist',
      tab_id: tabIdRef.current,
      complete: playlistComplete,
      current_index: currentIndex,
      tracks: playlist.map((item: MusicTrack, index: number) => ({
        index,
        id: item.id,
        name: item.name,
        aliases: item.aliases ?? [],
        title_extra: formatTitleAliases(item.name, item.aliases) || null,
        artists: item.artists.join(' / '),
        album: item.album,
        album_pic: toAbsoluteCoverUrl(item.albumPic, 96),
        duration_ms: item.duration ?? 0,
      })),
    })
  }, [currentIndex, playlist, playlistComplete, sendJSON, wsOpenEpoch])

  // 3.5 空闲推送前后一首相邻曲目的预热包（封面高分 URL、主色、副歌区间与已解析歌词），使桌面灵动岛切歌实现 0ms 瞬显
  const nextTrack = adjacentTracks.next
  const prevTrack = adjacentTracks.prev
  const nextPreloaded = usePassiveResolvedSongLyrics(nextTrack?.id ?? null, nextTrack)
  const prevPreloaded = usePassiveResolvedSongLyrics(prevTrack?.id ?? null, prevTrack)
  const nextCoverAccent = useCoverAccent(nextTrack?.albumPic)
  const prevCoverAccent = useCoverAccent(prevTrack?.albumPic)
  const lastPreloadSigRef = useRef<string>('')

  useEffect(() => {
    if (!wsOpenEpoch || !isPlaying || isAdoptHoldActive())
      return
    const buildItem = (
      track: MusicTrack | null,
      resolved: ReturnType<typeof usePassiveResolvedSongLyrics>,
      coverAcc: string | null,
    ) => {
      if (!track || resolved.status === 'loading' || resolved.pending)
        return null
      const titleExtra = formatTitleAliases(track.name, track.aliases)
      const inlineTitle = [track.name, track.artists.join(' / ')].filter(Boolean).join(' - ')
      return {
        track: {
          id: track.id,
          name: track.name,
          title_extra: titleExtra || null,
          artists: track.artists,
          display_artists: track.artists,
          inline_title: inlineTitle,
          album: track.album,
          album_pic: toAbsoluteCoverUrl(track.albumPic, 240),
          duration_ms: track.duration ?? 0,
        },
        accent_hex: resolved.lyrics.accent ?? coverAcc ?? null,
        chorus: getCachedSongChorus(track.id),
        lyrics: serializeLyrics(resolved.lyrics),
      }
    }

    const items = [
      buildItem(nextTrack, nextPreloaded, nextCoverAccent),
      prevTrack?.id !== nextTrack?.id ? buildItem(prevTrack, prevPreloaded, prevCoverAccent) : null,
    ].filter((item): item is NonNullable<typeof item> => item != null)

    const nextId = nextTrack?.id ?? null
    const prevId = prevTrack?.id ?? null
    if (items.length === 0 && nextId == null && prevId == null)
      return

    const sig = `${wsOpenEpoch}|${nextId ?? 0}|${prevId ?? 0}|${items.map(it => `${it.track.id}:${it.lyrics.source}:${it.accent_hex ?? ''}`).join(',')}`
    if (sig === lastPreloadSigRef.current)
      return

    const timer = window.setTimeout(() => {
      lastPreloadSigRef.current = sig
      sendJSON({
        type: 'preload',
        tab_id: tabIdRef.current,
        next_track_id: nextId,
        prev_track_id: prevId,
        items,
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [
    isPlaying,
    nextCoverAccent,
    nextPreloaded,
    nextTrack,
    prevCoverAccent,
    prevPreloaded,
    prevTrack,
    sendJSON,
    wsOpenEpoch,
  ])

  // 4. 构建并推送实时状态与时钟锚点帧（所有时长与进度严格以 _ms 毫秒为单位）
  const buildStatePayload = useCallback((
    currentPrefs: DesktopIslandPreferences,
    extraPositionMs?: number,
  ) => {
    const audio = actions.getAudio()
    const audioPlayingConfirmed = Boolean(audio && !audio.paused && !audio.ended && audio.readyState >= 2)
    if (audioPlayingConfirmed && adoptedPosFallbackSecRef.current)
      adoptedPosFallbackSecRef.current = null
    const audioDurationSec = audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : playbackDurationSec
    const resolvedDurationMs = (typeof audioDurationSec === 'number' && Number.isFinite(audioDurationSec) && audioDurationSec > 0)
      ? Math.round(audioDurationSec * 1000)
      : (currentTrack?.duration ?? 0)
    const fallbackEntry = adoptedPosFallbackSecRef.current
    const fallbackAdopted = (fallbackEntry && currentTrack?.id != null && fallbackEntry.trackId === currentTrack.id)
      ? fallbackEntry.sec
      : null
    const rawPosSec = (audio && audio.readyState >= 1 && Number.isFinite(audio.currentTime) && (audio.currentTime > 0 || fallbackAdopted == null))
      ? audio.currentTime
      : (fallbackAdopted ?? clock.getSnapshot())
    const posMs = extraPositionMs ?? (rawPosSec * 1000)
    const visible = Boolean(formattedTrack) && (showPlaying || (hasPlayed && (currentPrefs.keepWhenPaused || fallbackAdopted != null)))
    const inlineTitle = formattedTrack?.inline_title ?? ''
    const peekText = (peekTrackId != null && currentTrack?.id === peekTrackId) ? inlineTitle : null
    const pausedText = !showPlaying && hasPlayed ? (pausedLine ?? inlineTitle) : null

    return {
      type: 'state',
      tab_id: tabIdRef.current,
      visible,
      has_played: hasPlayed,
      show_playing: showPlaying,
      is_playing: isPlaying,
      audio_playing: audioPlayingConfirmed,
      pending_step: pendingStep ?? null,
      track_id: currentTrack?.id ?? null,
      lyric_status: lyricStatus,
      lyric_sources_pending: lyricSourcesPending,
      duration_ms: resolvedDurationMs,
      position_ms: Number.isFinite(posMs) ? Math.max(0, posMs) : 0,
      seek_at_ms: Number.isFinite(seekAtRef.current) ? seekAtRef.current : null,
      anchor_ms: Date.now(),
      play_mode: playMode,
      volume,
      muted: isMuted,
      peek_text: peekText,
      paused_text: pausedText,
      glow: currentPrefs.chorusGlow ? glow : null,
      preferences: {
        show_translation: showTranslation,
        can_toggle_translation: canToggleTranslation,
        translations_generating: lyricTranslationsGenerating,
        translation_selections: activeTranslationSelections.map(s => ({
          lang: s.lang,
          prefer_native: Boolean(s.preferNative),
        })),
        song_lang_label: songLangLabel || null,
        available_translation_langs: availableLangItems,
        show_romaji: showRomaji,
        can_toggle_romaji: canToggleRomaji,
        pronunciations_generating: lyricPronunciationsGenerating,
        show_lyric_effects: showLyricEffects,
        show_lyric_moments: showLyricMoments,
      },
      config: {
        form_mode: currentPrefs.formMode,
        expandable: currentPrefs.expandable,
        beat_bars: currentPrefs.beatBars,
        chorus_glow: currentPrefs.chorusGlow,
        hdr: currentPrefs.hdr,
      },
    }
  }, [
    actions,
    activeTranslationSelections,
    availableLangItems,
    canToggleRomaji,
    canToggleTranslation,
    clock,
    currentTrack?.duration,
    currentTrack?.id,
    formattedTrack,
    glow,
    hasPlayed,
    isMuted,
    isPlaying,
    lyricPronunciationsGenerating,
    lyricSourcesPending,
    lyricStatus,
    lyricTranslationsGenerating,
    pausedLine,
    peekTrackId,
    pendingStep,
    playMode,
    playbackDurationSec,
    showLyricEffects,
    showLyricMoments,
    showPlaying,
    showRomaji,
    showTranslation,
    songLangLabel,
    volume,
  ])

  const sendStateRef = useRef<() => void>(() => {})
  sendStateRef.current = () => {
    if (
      pageHiddenUnloadRef.current
      || performance.now() < unloadGuardUntilRef.current
      || adoptingStateRef.current
      || performance.now() < passiveAdoptRequestHoldUntilRef.current
    ) {
      return
    }
    sendJSON(buildStatePayload(prefs))
  }

  useEffect(() => {
    if (!wsOpenEpoch)
      return
    sendStateRef.current()
    if (pendingAdoptedNotifyRef.current && !adoptingStateRef.current) {
      pendingAdoptedNotifyRef.current = false
      sendJSON({
        type: 'native_session_adopted',
        tab_id: tabIdRef.current,
      })
    }
  }, [buildStatePayload, prefs, sendJSON, wsOpenEpoch])

  useEffect(() => {
    if (!wsOpenEpoch)
      return
    const audio = actions.getAudio()
    const syncImmediate = () => sendStateRef.current()
    const onSeeked = () => {
      if (audio)
        seekAtRef.current = audio.currentTime * 1000
      sendStateRef.current()
    }
    const events = ['play', 'playing', 'pause', 'ratechange', 'waiting', 'ended', 'loadedmetadata', 'durationchange'] as const
    if (audio) {
      audio.addEventListener('seeked', onSeeked)
      for (const ev of events)
        audio.addEventListener(ev, syncImmediate)
    }

    // 暂停态拖动进度条或挂载恢复进度（clock.set）时即时同步到桌面灵动岛
    let lastPausedClockMs = clock.getSnapshot() * 1000
    const unsubscribeClock = clock.subscribe(() => {
      if (isPlaying)
        return
      const nextMs = clock.getSnapshot() * 1000
      if (Math.abs(nextMs - lastPausedClockMs) >= 80) {
        lastPausedClockMs = nextMs
        sendStateRef.current()
      }
    })

    let heartbeat = 0
    if (isPlaying)
      heartbeat = window.setInterval(syncImmediate, CLOCK_SYNC_HEARTBEAT_MS)

    return () => {
      unsubscribeClock()
      if (audio) {
        audio.removeEventListener('seeked', onSeeked)
        for (const ev of events)
          audio.removeEventListener(ev, syncImmediate)
      }
      if (heartbeat)
        window.clearInterval(heartbeat)
    }
  }, [actions, clock, isPlaying, wsOpenEpoch, currentTrack?.id])

  return null
}
