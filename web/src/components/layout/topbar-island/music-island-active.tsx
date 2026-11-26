'use client'

import type { IslandActivity, IslandGlow } from '@/contexts/topbar-island'
import type { MusicTrack } from '@/models/music'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlbumNavIcon, MINI_PLAYER_POPOVER_CLASSNAME, MINI_PLAYER_POPOVER_STYLE, useMiniPlayerHolding } from '@/components/common/music-player-shared'
import { useCoverAccent } from '@/components/music-page/use-cover-accent'
import { useMusicActions, useMusicClockStore, useMusicLyrics, useMusicPlayback, useMusicPreferences } from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { useCachedSongMetaTranslation } from '@/contexts/song-meta-translations'
import { dismissIslandAlert, pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { useDesktopIslandPrefs, useDesktopIslandRuntime } from '@/hooks/use-desktop-island-pref'
import { usePathname } from '@/i18n/navigation'
import { getLyricLineVocalStart } from '@/lib/lyrics/line-utils'
import { lyricGlowAt } from '@/lib/lyrics/lyric-glow'
import { formatDisplayArtists, formatInlineSongTitle } from '@/lib/lyrics/song-meta-format'
import { buildTimeline, getLineTextAt } from '@/lib/lyrics/timeline'

const loadCompact = () => import('./music-island-compact')
const loadPlayer = () => import('@/components/common/mini-player')

const PLAYING_PRIORITY = 50
const PAUSED_PRIORITY = 10
const PEEK_MS = 1500
const PEEK_KEY = 'music-track'
const PAUSE_SETTLE_MS = 350

const noopSubscribe = () => () => {}
const falseSnapshot = () => false
const emptySnapshot = () => ''

function trackTitle(track: MusicTrack, translatedTitle?: string | null, translatedArtists?: string[] | null, showTranslation = true) {
  const displayName = formatInlineSongTitle(track.name, [], translatedTitle, showTranslation)
  const displayArtists = formatDisplayArtists(track.artists, translatedArtists, showTranslation)
  return [displayName, displayArtists.join(' / ')].filter(Boolean).join(' - ')
}

export function MusicIslandActive({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const { currentTrack, isPlaying, hasPlayed: sessionHasPlayed } = useMusicPlayback()
  const { play } = useMusicActions()
  const onPlayerPage = usePathname() === '/music'
  const floatingOpen = useMiniPlayerHolding('floating')
  const desktopPrefs = useDesktopIslandPrefs()
  const { status: desktopStatus } = useDesktopIslandRuntime()
  const islandStandby = floatingOpen || (desktopPrefs.enabled && desktopPrefs.hideWebIslandWhenConnected && desktopStatus === 'connected')

  const [localHasPlayed, setLocalHasPlayed] = useState(false)
  const hasPlayed = Boolean(sessionHasPlayed) || localHasPlayed
  if (isPlaying && !localHasPlayed)
    setLocalHasPlayed(true)
  const [pauseSettled, setPauseSettled] = useState(() => !isPlaying)
  useEffect(() => {
    if (isPlaying) {
      setPauseSettled(false)
      return
    }
    const timer = window.setTimeout(setPauseSettled, PAUSE_SETTLE_MS, true)
    return () => window.clearTimeout(timer)
  }, [isPlaying])

  const showPlaying = isPlaying || (hasPlayed && !pauseSettled)
  const coverAccent = useCoverAccent(isPlaying && settings.musicChorus && !islandStandby ? currentTrack?.albumPic : undefined)
  const inChorus = useInChorus(isPlaying && settings.musicChorus && !islandStandby ? currentTrack?.id ?? null : null)
  const glow = useLyricGlow(inChorus, coverAccent)
  const lyricStarted = useLyricStarted(isPlaying)
  const pausedLine = usePausedLine(!showPlaying && hasPlayed)
  const { showTranslation } = useMusicPreferences()
  const meta = useCachedSongMetaTranslation(currentTrack?.id ?? null)
  const title = currentTrack ? trackTitle(currentTrack, meta?.title, meta?.artists, showTranslation) : ''
  const wanted = Boolean(currentTrack) && (isPlaying || hasPlayed) && !onPlayerPage
  const compactModule = useLazyModule(loadCompact, wanted)
  const playerModule = useLazyModule(loadPlayer, wanted)

  const activity = useMemo<IslandActivity | null>(() => {
    if (!currentTrack || onPlayerPage || !compactModule || !playerModule)
      return null
    const { MusicCompact } = compactModule
    const { MiniPlayer } = playerModule
    if (showPlaying) {
      return {
        id: 'music',
        feature: 'music',
        hideable: true,
        sessionKey: String(currentTrack.id),
        standby: islandStandby,
        priority: PLAYING_PRIORITY,
        label: t('music_playing', { title }),
        compact: <MusicCompact beat={settings.musicBeat} title={title} />,
        minimal: <AlbumNavIcon />,
        panel: <MiniPlayer />,
        panelClassName: MINI_PLAYER_POPOVER_CLASSNAME,
        panelStyle: MINI_PLAYER_POPOVER_STYLE,
        glow,
      }
    }
    if (!hasPlayed)
      return null
    return {
      id: 'music',
      feature: 'musicPaused',
      hideable: true,
      sessionKey: String(currentTrack.id),
      standby: islandStandby,
      priority: PAUSED_PRIORITY,
      label: t('music_paused', { title }),
      compact: <MusicCompact beat={settings.musicBeat} title={title} paused text={pausedLine ?? title} />,
      minimal: <AlbumNavIcon />,
      onPress: play,
    }
  }, [compactModule, currentTrack, glow, hasPlayed, islandStandby, onPlayerPage, pausedLine, play, playerModule, settings.musicBeat, showPlaying, t, title])
  useIslandActivity(activity)

  const peekedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isPlaying || !currentTrack || onPlayerPage || peekedRef.current === currentTrack.id)
      return
    peekedRef.current = currentTrack.id
    if (lyricStarted || islandStandby)
      return
    pushIslandAlert({
      key: PEEK_KEY,
      feature: 'musicPeek',
      layer: 'notice',
      resume: 'drop',
      icon: currentTrack.albumPic ? <AlbumNavIcon /> : undefined,
      text: title,
      announce: t('music_now_playing', { title }),
      duration: PEEK_MS,
    })
  }, [currentTrack, isPlaying, onPlayerPage, t])

  useEffect(() => {
    if (lyricStarted || islandStandby)
      dismissIslandAlert(PEEK_KEY)
  }, [currentTrack?.id, islandStandby, lyricStarted])

  return null
}

function useLazyModule<T>(load: () => Promise<T>, enabled: boolean): T | null {
  const [loaded, setLoaded] = useState<T | null>(null)
  useEffect(() => {
    if (!enabled || loaded)
      return
    let cancelled = false
    load().then((mod) => {
      if (!cancelled)
        setLoaded(mod)
    }, () => {})
    return () => {
      cancelled = true
    }
  }, [enabled, load, loaded])
  return loaded
}

function useLyricStarted(enabled: boolean) {
  const { lyricLines } = useMusicLyrics()
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(
    () => lyricLines.length > 0 && clock.getSnapshot() * 1000 >= getLyricLineVocalStart(lyricLines[0]),
    [clock, lyricLines],
  )
  return useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : falseSnapshot, falseSnapshot)
}

function usePausedLine(enabled: boolean) {
  const { lyrics } = useMusicLyrics()
  const clock = useMusicClockStore()
  const items = useMemo(() => buildTimeline(lyrics.lines), [lyrics.lines])
  const getSnapshot = useCallback(
    () => getLineTextAt(lyrics.lines, items, clock.getSnapshot() * 1000) ?? '',
    [clock, items, lyrics.lines],
  )
  return useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : emptySnapshot, emptySnapshot) || null
}

function useLyricGlow(enabled: boolean, fallback: string | null): IslandGlow | null {
  const { lyrics } = useMusicLyrics()
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(() => {
    const { color, strong } = lyricGlowAt(lyrics, clock.getSnapshot() * 1000)
    return `${color ?? ''}|${strong ? 1 : 0}`
  }, [clock, lyrics])
  const key = useSyncExternalStore(enabled ? clock.subscribe : noopSubscribe, enabled ? getSnapshot : emptySnapshot, emptySnapshot)
  return useMemo(() => {
    if (!enabled)
      return null
    const [color, strong] = key.split('|')
    return { color: color || fallback || 'rgb(255 255 255)', strong: strong === '1' }
  }, [enabled, fallback, key])
}

function useInChorus(id: number | null) {
  const chorus = useSongChorus(id)
  const clock = useMusicClockStore()
  const getSnapshot = useCallback(() => {
    const ms = clock.getSnapshot() * 1000
    return chorus.some(item => ms >= item.start && ms < item.end)
  }, [chorus, clock])
  return useSyncExternalStore(id == null ? noopSubscribe : clock.subscribe, id == null ? falseSnapshot : getSnapshot, falseSnapshot)
}
