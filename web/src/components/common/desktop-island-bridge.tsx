'use client'

import type { PlayMode } from '@/contexts/music-context'
import type { DesktopIslandPreferences } from '@/hooks/use-desktop-island-pref'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { RhythmModel } from '@/lib/lyrics/rhythm/model'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import type { LyricAgent, ResolvedLyrics } from '@/lib/lyrics/types'
import type { MusicTrack } from '@/models/music'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSongAccent } from '@/components/music-page/use-cover-accent'
import {
  useMusicActions,
  useMusicClockStore,
  useMusicLyrics,
  useMusicPlayback,
  useMusicPreferences,
  useMusicVolume,
} from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import {
  setDesktopIslandRuntimeStatus,
  updateDesktopIslandPrefs,
  useDesktopIslandPrefs,
  useDesktopIslandRuntime,
} from '@/hooks/use-desktop-island-pref'
import { useRouter } from '@/i18n/navigation'
import { LYRIC_COLORS, MOOD_GLOW, resolveAgentHex } from '@/lib/lyrics/colors'
import { getBackgroundOwnerMap, getLyricLineAlign, getLyricLineVocalStart } from '@/lib/lyrics/line-utils'
import { lyricGlowAt } from '@/lib/lyrics/lyric-glow'
import { toggleLyricTranslationSelection } from '@/lib/lyrics/lyric-language'
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

const noopSubscribe = () => () => {}
const falseSnapshot = () => false
const emptySnapshot = () => ''
const nullRhythmSnapshot = () => null

function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return `tab_${crypto.randomUUID().slice(0, 8)}`
  return `tab_${Math.random().toString(36).slice(2, 10)}`
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

const TRANSLATION_LANG_INTL_CODES: Record<string, string> = {
  'zh': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-HK',
}

function formatTranslationLangLabel(lang: string, locale: string): string {
  try {
    const code = TRANSLATION_LANG_INTL_CODES[lang] ?? lang
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? lang
  }
  catch {
    return lang
  }
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
  lang?: string
  prefer_native?: boolean
  has_dual_sources?: boolean
}

/**
 * 网页播放器 ↔ 本地 macOS 系统灵动岛桥接组件：
 * - 音频仍在浏览器 <audio> 中播放，macOS 灵动岛只负责显示与反向遥控；
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
  const locale = useLocale()

  const {
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    duration: playbackDurationSec,
    playlistComplete,
    pendingStep,
  } = useMusicPlayback()
  const {
    lyrics,
    lyricLines,
    lyricStatus,
    lyricSourcesPending,
    refreshLyrics,
    canToggleTranslation,
    lyricTranslationsGenerating,
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

  // 与 music-island.tsx 一致：本页播放过才在暂停后保留
  const [hasPlayed, setHasPlayed] = useState(false)
  if (isPlaying && !hasPlayed)
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

  const activeTranslationSelections = useMemo<LyricTranslationSelection[]>(() => {
    if (translationSelections !== undefined)
      return translationSelections
    return translationLang ? [{ lang: translationLang, preferNative: Boolean(preferNativeTranslation) }] : []
  }, [preferNativeTranslation, translationLang, translationSelections])

  const availableLangItems = useMemo(() => {
    return (availableTranslationLangs ?? [])
      .filter(item => item.hasAi || item.hasNative || item.generating)
      .map(item => ({
        lang: item.lang,
        label: formatTranslationLangLabel(item.lang, locale),
        has_ai: Boolean(item.hasAi),
        has_native: Boolean(item.hasNative),
        generating: Boolean(item.generating),
      }))
  }, [availableTranslationLangs, locale])

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

  const wsRef = useRef<WebSocket | null>(null)
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
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    desktopHdr: prefs.hdr,
    activeTranslationSelections,
    playlist,
  })
  commandContextRef.current = {
    actions,
    refreshLyrics,
    router,
    showTranslation,
    showRomaji,
    showLyricEffects,
    showLyricMoments,
    hdr,
    desktopHdr: prefs.hdr,
    activeTranslationSelections,
    playlist,
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
      case 'open_player_page':
        ctx.router.push('/music')
        window.focus()
        break
      case 'sync_snapshot':
        setWsOpenEpoch(n => (n > 0 ? n + 1 : 1))
        break
    }
  }, [])

  // 建立并维护本地 ws://127.0.0.1:<port>/ws 长连接（指数退避自动重连）
  useEffect(() => {
    if (!prefs.enabled) {
      setDesktopIslandRuntimeStatus('disabled')
      return
    }

    let disposed = false
    let retryAttempt = 0
    let retryTimer = 0

    const connect = () => {
      if (disposed)
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
        if (disposed) {
          socket.close()
          return
        }
        retryAttempt = 0
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
        if (disposed)
          return
        setDesktopIslandRuntimeStatus('disconnected')
        const delay = Math.min(8000, 1000 * 2 ** Math.min(3, retryAttempt))
        retryAttempt += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => {}
    }

    connect()

    const onPageHide = () => {
      wsRef.current?.close()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
        retryAttempt = 0
        connect()
      }
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
      const active = wsRef.current
      wsRef.current = null
      active?.close()
      setDesktopIslandRuntimeStatus(prefs.enabled ? 'disconnected' : 'disabled')
    }
  }, [handleIncomingCommand, prefs.enabled, prefs.port, reconnectEpoch])

  // 1. 推送曲目与完整歌词结构
  useEffect(() => {
    if (!wsOpenEpoch)
      return
    sendJSON({
      type: 'media',
      tab_id: tabIdRef.current,
      track: formattedTrack,
      accent_hex: accent ?? null,
      chorus,
      lyrics: serializeLyrics(lyrics),
    })
  }, [accent, chorus, formattedTrack, lyrics, sendJSON, wsOpenEpoch])

  // 2. 推送真实音频节拍脉冲列（供桌面灵动岛同步驱动律动条、背景呼吸染色与全部节拍卷积特效）
  useEffect(() => {
    if (!wsOpenEpoch)
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
    if (!wsOpenEpoch)
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

  // 4. 构建并推送实时状态与时钟锚点帧（所有时长与进度严格以 _ms 毫秒为单位）
  const buildStatePayload = useCallback((
    currentPrefs: DesktopIslandPreferences,
    extraPositionMs?: number,
  ) => {
    const audio = actions.getAudio()
    const audioDurationSec = audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : playbackDurationSec
    const resolvedDurationMs = (typeof audioDurationSec === 'number' && Number.isFinite(audioDurationSec) && audioDurationSec > 0)
      ? Math.round(audioDurationSec * 1000)
      : (currentTrack?.duration ?? 0)
    const rawPosSec = audio && Number.isFinite(audio.currentTime)
      ? audio.currentTime
      : clock.getSnapshot()
    const posMs = extraPositionMs ?? (rawPosSec * 1000)
    const visible = Boolean(formattedTrack) && (showPlaying || (hasPlayed && currentPrefs.keepWhenPaused))
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
    volume,
  ])

  const sendStateRef = useRef<() => void>(() => {})
  sendStateRef.current = () => {
    sendJSON(buildStatePayload(prefs))
  }

  useEffect(() => {
    if (!wsOpenEpoch)
      return
    sendStateRef.current()
  }, [buildStatePayload, prefs, wsOpenEpoch])

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
