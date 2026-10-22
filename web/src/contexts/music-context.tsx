'use client'
import type { MusicLyrics } from '@/api/music'
import type { MusicTrack } from '@/models/music'
import type { MusicLyricItem, MusicLyricLine, MusicLyricMode } from '@/utils/music-lyric'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { fetchNcmLyric } from '@/api/music'
import { getCurrentLyricIndex, getCurrentWordIndex, parseMusicLyrics } from '@/utils/music-lyric'

export type PlayMode = 'repeat-all' | 'repeat-one' | 'shuffle'

interface MusicContextValue {
  // 播放状态
  playlist: MusicTrack[]
  currentIndex: number | null
  currentTrack: MusicTrack | null
  isPlaying: boolean
  playMode: PlayMode
  currentTime: number | null
  duration: number | null
  bufferedPercent: number
  volume: number
  isMuted: boolean
  currentLyric: string | null
  currentLyricIndex: number | null
  currentLyricWords: MusicLyricItem[]
  currentWordIndex: number | null
  lyricLines: { time: number, text: string }[]
  parsedLyricLines: MusicLyricLine[]
  translationLyricLines: MusicLyricLine[]
  romajiLyricLines: MusicLyricLine[]
  lyricSourceType: 'yrc' | 'lrc' | 'none'
  lyricMode: MusicLyricMode
  setLyricMode: (mode: MusicLyricMode) => void
  hasTranslationLyric: boolean
  hasRomajiLyric: boolean
  getAudio: () => HTMLAudioElement | null

  // 播放列表 操作
  // startTime：起始曲目的初始播放进度（秒），用于刷新后恢复进度，会在该曲目元数据就绪后应用
  replacePlaylist: (tracks: MusicTrack[], startIndex?: number, startTime?: number) => void

  // 播放控制
  playTrack: (index: number) => void // 指定播放曲目
  play: () => void // 播放
  pause: () => void // 暂停
  togglePlay: () => void // 切换播放/暂停
  next: () => void // 下一首
  prev: () => void // 上一首
  setPlayMode: (m: PlayMode) => void // 设置播放模式
  setCurrentIndex: (i: number | null) => void // 设置当前索引切换曲目

  // 可选：音量/进度控制
  seek: (seconds: number) => void // 跳转到指定秒数
  setVolume: (v: number) => void // 设置音量 0~1
  toggleMuted: () => void // 切换静音

  // sample track 样品曲目，用于在未获取到时fallback
  sampleTrack: MusicTrack
}

const MusicContext = createContext<MusicContextValue | null>(null)

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext)
  if (!ctx)
    throw new Error('useMusic must be used within MusicProvider')
  return ctx
}

/**
 * 计算相邻曲目索引：direction 为 1 表示下一首，-1 表示上一首；随机模式下尽量避开当前曲目
 */
function getAdjacentIndex(list: MusicTrack[], curr: number | null, mode: PlayMode, direction: 1 | -1): number | null {
  if (list.length === 0)
    return null
  if (mode === 'shuffle') {
    if (list.length === 1)
      return 0
    let idx = Math.floor(Math.random() * list.length)
    if (idx === curr)
      idx = (idx + 1) % list.length
    return idx
  }
  if (curr == null)
    return direction === 1 ? 0 : list.length - 1
  return (curr + direction + list.length) % list.length
}

export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingPlayRef = useRef(false)
  // 待恢复的播放进度：仅当音频元数据就绪且当前曲目 id 一致时才应用，避免进度被应用到别的曲目上
  const pendingSeekRef = useRef<{ trackId: number, time: number } | null>(null)
  const prevTrackIdRef = useRef<number | null>(null)
  const [playlist, setPlaylist] = useState<MusicTrack[]>([])
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playMode, setPlayMode] = useState<PlayMode>('repeat-all')
  const [currentTime, setCurrentTime] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [bufferedPercent, setBufferedPercent] = useState<number>(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  // 原始歌词响应，与所属曲目 id 绑定；只有 trackId 与当前曲目一致时才会被使用
  const [lyricState, setLyricState] = useState<{ trackId: number, lyrics: MusicLyrics | null } | null>(null)
  const [lyricMode, setLyricModeState] = useState<MusicLyricMode>('translation')
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const currentTrackId = currentTrack?.id ?? null
  const getAudio = useCallback(() => audioRef.current, [])

  // 供事件回调读取最新值，避免闭包拿到过期的 playlist / index / mode
  const playlistRef = useRef(playlist)
  const currentIndexRef = useRef(currentIndex)
  const playModeRef = useRef(playMode)
  useEffect(() => {
    playlistRef.current = playlist
    currentIndexRef.current = currentIndex
    playModeRef.current = playMode
  }, [playlist, currentIndex, playMode])

  useEffect(() => {
    if (typeof window === 'undefined')
      return

    try {
      const storedVolume = localStorage.getItem('music-volume')
      if (storedVolume != null) {
        const nextVolume = Math.max(0, Math.min(1, Number(JSON.parse(storedVolume))))
        if (Number.isFinite(nextVolume)) {
          setVolumeState(nextVolume)
          if (audioRef.current)
            audioRef.current.volume = nextVolume
        }
      }

      const storedMuted = localStorage.getItem('music-muted')
      if (storedMuted != null) {
        const nextMuted = Boolean(JSON.parse(storedMuted))
        setIsMuted(nextMuted)
        if (audioRef.current)
          audioRef.current.muted = nextMuted
      }

      const storedLyricMode = localStorage.getItem('music-lyric-mode')
      if (storedLyricMode != null) {
        const nextLyricMode = JSON.parse(storedLyricMode)
        if (nextLyricMode === 'none' || nextLyricMode === 'romaji' || nextLyricMode === 'translation')
          setLyricModeState(nextLyricMode)
      }
    }
    catch (error) {
      console.error('Failed to restore music preferences:', error)
    }
  }, [])

  // 创建 audio 元素并做基础配置（仅在客户端）
  useEffect(() => {
    if (typeof window === 'undefined')
      return
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.volume = volume
      audio.muted = isMuted
      audioRef.current = audio
    }
  }, [isMuted, volume])

  useEffect(() => {
    if (!audioRef.current)
      return
    audioRef.current.volume = volume
    audioRef.current.muted = isMuted
  }, [isMuted, volume])

  // 仅在曲目 id 变化时切换 audio.src，并在 pendingPlay 时尝试播放
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (currentTrackId == null) {
      if (prevTrackIdRef.current != null) {
        audio.removeAttribute('src')
        audio.load()
        prevTrackIdRef.current = null
      }
      return
    }
    if (prevTrackIdRef.current === currentTrackId)
      return

    const track = playlistRef.current[currentIndexRef.current ?? -1]
    prevTrackIdRef.current = currentTrackId
    // 切换曲目时重置时长与进度，避免进度条短暂沿用上一首的时长
    setDuration(null)
    setCurrentTime(0)
    setBufferedPercent(0)
    audio.src = track?.audio || ''
    audio.currentTime = 0
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false
      void audio.play().catch(() => {
        /* play 可能被浏览器阻止（自动播放策略），事件监听会同步状态 */
      })
    }
  }, [currentTrackId])

  // 歌词按曲目 id 获取：切歌时中止旧请求，并丢弃不属于当前曲目的响应
  useEffect(() => {
    if (currentTrackId == null)
      return
    const controller = new AbortController()
    const trackId = currentTrackId
    fetchNcmLyric(trackId, controller.signal).then((lyrics) => {
      if (!controller.signal.aborted)
        setLyricState({ trackId, lyrics })
    }).catch(() => {
      if (!controller.signal.aborted)
        setLyricState({ trackId, lyrics: null })
    })
    return () => controller.abort()
  }, [currentTrackId])

  // 切换到指定索引；目标与当前曲目相同时（如单曲歌单）直接从头播放，避免 effect 不触发导致停播
  const goTo = useCallback((index: number | null, autoplay: boolean) => {
    if (index == null) {
      currentIndexRef.current = null
      setCurrentIndex(null)
      return
    }
    const audio = audioRef.current
    if (index === currentIndexRef.current) {
      if (audio) {
        audio.currentTime = 0
        if (autoplay)
          void audio.play().catch(() => { })
      }
      return
    }
    pendingPlayRef.current = autoplay
    // 立即同步 ref，保证连续切歌时基于最新索引计算
    currentIndexRef.current = index
    setCurrentIndex(index)
  }, [])

  // 统一通过 audio 事件驱动上下文状态（isPlaying / time / duration / buffered）
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

    let rafId: number | null = null
    let lastTimeTick = 0

    const onPlay = () => {
      setIsPlaying(true)
    }
    const onPause = () => {
      setIsPlaying(false)
    }

    const updateBuffered = () => {
      try {
        if (audio.buffered.length > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          const end = audio.buffered.end(audio.buffered.length - 1)
          setBufferedPercent(Math.min(1, end / audio.duration))
        }
        else {
          setBufferedPercent(0)
        }
      }
      catch {
        setBufferedPercent(0)
      }
    }

    const onLoaded = () => {
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek && pendingSeek.trackId === prevTrackIdRef.current && Number.isFinite(audio.duration) && audio.duration > 0) {
        pendingSeekRef.current = null
        try {
          audio.currentTime = Math.max(0, Math.min(pendingSeek.time, audio.duration))
        }
        catch { }
      }
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
      setCurrentTime(audio.currentTime ?? 0)
      updateBuffered()
    }
    const onTimeUpdate = () => {
      // RAF 节流，避免每帧都 setState
      const now = performance.now()
      if (now - lastTimeTick < 120) {
        rafId ??= requestAnimationFrame(() => {
          setCurrentTime(audio.currentTime)
          lastTimeTick = performance.now()
          rafId = null
        })
        return
      }
      setCurrentTime(audio.currentTime)
      lastTimeTick = now
    }
    const onEnded = () => {
      if (playModeRef.current === 'repeat-one') {
        audio.currentTime = 0
        void audio.play().catch(() => { })
        return
      }
      goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, 1), true)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('progress', updateBuffered)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('progress', updateBuffered)
      audio.removeEventListener('ended', onEnded)
      if (rafId != null)
        cancelAnimationFrame(rafId)
    }
  }, [goTo])

  // 歌词解析为 skos-player 同风格的数据结构；YRC 可提供逐字时间，LRC 自动退化为逐行。
  // 只使用属于当前曲目的歌词，切歌后旧歌词立即失效
  const activeLyrics = lyricState != null && lyricState.trackId === currentTrackId ? lyricState.lyrics : null
  const parsedLyrics = useMemo(() => {
    if (!activeLyrics)
      return null
    try {
      return parseMusicLyrics(activeLyrics)
    }
    catch (error) {
      console.error('Failed to parse lyrics:', error)
      return null
    }
  }, [activeLyrics])
  const parsedLyricLines = useMemo(() => parsedLyrics?.lines ?? [], [parsedLyrics])
  const translationLyricLines = useMemo(() => parsedLyrics?.translationLines ?? [], [parsedLyrics])
  const romajiLyricLines = useMemo(() => parsedLyrics?.romajiLines ?? [], [parsedLyrics])
  const lyricSourceType = parsedLyrics?.sourceType ?? 'none'
  const lyricLines = useMemo(() => parsedLyricLines.map(line => ({
    time: line.startTime / 1000,
    text: line.originalText,
  })), [parsedLyricLines])

  const currentTimeMs = currentTime == null ? null : currentTime * 1000
  const currentLyricIndex = parsedLyricLines.length === 0 || currentTimeMs == null
    ? null
    : getCurrentLyricIndex(parsedLyricLines, currentTimeMs, null)
  const currentLyricLine = currentLyricIndex == null ? undefined : parsedLyricLines[currentLyricIndex]
  const currentLyric = currentLyricLine?.originalText ?? null
  const currentWordIndex = currentTimeMs == null ? null : getCurrentWordIndex(currentLyricLine, currentTimeMs)

  // 操作函数 —— 不直接 set isPlaying/currentTime（由事件回路同步）
  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0, startTime?: number) => {
    const index = tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null
    const track = index == null ? null : tracks[index]
    pendingSeekRef.current = track && startTime != null && Number.isFinite(startTime) && startTime > 0
      ? { trackId: track.id, time: startTime }
      : null
    // 新歌单的起始曲目与正在加载的曲目相同时，src 不会重新加载，若元数据已就绪需立即应用进度
    const audio = audioRef.current
    if (audio && pendingSeekRef.current && pendingSeekRef.current.trackId === prevTrackIdRef.current && audio.readyState >= 1) {
      try {
        audio.currentTime = Math.max(0, Math.min(pendingSeekRef.current.time, audio.duration || pendingSeekRef.current.time))
      }
      catch { }
      pendingSeekRef.current = null
    }
    playlistRef.current = tracks
    currentIndexRef.current = index
    setPlaylist(tracks)
    setCurrentIndex(index)
  }, [])

  const playTrack = useCallback((index: number) => {
    if (index < 0 || index >= playlistRef.current.length)
      return
    // 点击正在播放的曲目时仅继续播放，不从头开始
    if (index === currentIndexRef.current) {
      void audioRef.current?.play().catch(() => { })
      return
    }
    goTo(index, true)
  }, [goTo])

  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    void audio.play().catch(() => {
      /* 失败或被阻止，事件处理会同步状态 */
    })
  }, [])

  const pause = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    audio.pause()
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (audio.paused) {
      void audio.play().catch(() => { })
    }
    else {
      audio.pause()
    }
  }, [])

  const next = useCallback(() => {
    goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, 1), true)
  }, [goTo])

  const prev = useCallback(() => {
    goTo(getAdjacentIndex(playlistRef.current, currentIndexRef.current, playModeRef.current, -1), true)
  }, [goTo])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio)
      return
    setCurrentTime(Math.max(0, Math.min(seconds, audio.duration || seconds)))
    try {
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    }
    catch {
    }
  }, [])

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    const nextVolume = Math.max(0, Math.min(1, v))
    setVolumeState(nextVolume)
    if (audio)
      audio.volume = nextVolume
    try {
      localStorage.setItem('music-volume', JSON.stringify(nextVolume))
    }
    catch { }
  }, [])

  const toggleMuted = useCallback(() => {
    setIsMuted((prev) => {
      const nextMuted = !prev
      if (audioRef.current)
        audioRef.current.muted = nextMuted
      try {
        localStorage.setItem('music-muted', JSON.stringify(nextMuted))
      }
      catch { }
      return nextMuted
    })
  }, [])

  const setLyricMode = useCallback((mode: MusicLyricMode) => {
    setLyricModeState(mode)
    try {
      localStorage.setItem('music-lyric-mode', JSON.stringify(mode))
    }
    catch { }
  }, [])

  const sampleTrack: MusicTrack = {
    id: 0,
    name: 'Sample Track',
    artists: ['Sample Artist'],
    album: 'Sample Album',
    albumPic: 'https://via.placeholder.com/150',
    audio: '',
    lyric: '',
    link: '',
    aliases: [],
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.mediaSession)
      return
    const ms = navigator.mediaSession
    const audio = audioRef.current
    if (!audio)
      return

    const makeArtwork = (url?: string) => {
      if (!url)
        return []
      return [
        { src: url, sizes: '512x512', type: 'image/png' },
        { src: url, sizes: '96x96', type: 'image/png' },
      ]
    }

    const updateMetadata = () => {
      if (!currentTrack) {
        try {
          ms.metadata = null
        }
        catch { }
        ms.playbackState = 'none'
        return
      }
      try {
        ms.metadata = new MediaMetadata({
          title: currentTrack.name ?? '',
          artist: Array.isArray(currentTrack.artists) ? currentTrack.artists.join(', ') : (currentTrack.artists ?? ''),
          album: currentTrack.album ?? '',
          artwork: makeArtwork(currentTrack.albumPic),
        })
      }
      catch {
        // 某些环境可能不支持构造函数
        try {
          ms.metadata = {
            title: currentTrack.name ?? '',
            artist: Array.isArray(currentTrack.artists) ? currentTrack.artists.join(', ') : (currentTrack.artists ?? ''),
            album: currentTrack.album ?? '',
            artwork: makeArtwork(currentTrack.albumPic),
          }
        }
        catch { }
      }
      ms.playbackState = isPlaying ? 'playing' : 'paused'
    }

    try {
      ms.setActionHandler('play', () => play())
      ms.setActionHandler('pause', () => pause())
      ms.setActionHandler('previoustrack', () => prev())
      ms.setActionHandler('nexttrack', () => next())
      ms.setActionHandler('seekto', (details) => {
        if (!audio || typeof details?.seekTime !== 'number')
          return
        if (details.fastSeek && typeof audio.fastSeek === 'function') {
          try {
            audio.fastSeek(details.seekTime)
          }
          catch {
            audio.currentTime = details.seekTime
          }
        }
        else {
          audio.currentTime = details.seekTime
        }
      })
    }
    catch {
      // 某些浏览器/环境对 setActionHandler 有限制
    }

    // 同步 position state
    const onTimeUpdate = () => {
      try {
        if ('setPositionState' in ms && audio && Number.isFinite(audio.duration) && audio.duration > 0) {
          ms.setPositionState({
            duration: audio.duration,
            position: audio.currentTime,
            playbackRate: audio.playbackRate ?? 1,
          })
        }
      }
      catch { }
    }

    updateMetadata()
    audio.addEventListener('timeupdate', onTimeUpdate)
    // 当 track 或 isPlaying 变化时也更新 metadata/playbackState
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
        ms.setActionHandler('seekto', null)
      }
      catch { }
    }
  }, [currentTrack, isPlaying, play, pause, next, prev])

  const value: MusicContextValue = {
    playlist,
    currentIndex,
    currentTrack,
    isPlaying,
    playMode,
    currentTime,
    duration,
    bufferedPercent,
    volume,
    isMuted,
    currentLyric,
    currentLyricIndex,
    currentLyricWords: currentLyricLine?.items ?? [],
    currentWordIndex,
    lyricLines,
    parsedLyricLines,
    translationLyricLines,
    romajiLyricLines,
    lyricSourceType,
    lyricMode,
    setLyricMode,
    hasTranslationLyric: translationLyricLines.length > 0,
    hasRomajiLyric: romajiLyricLines.length > 0,
    getAudio,
    replacePlaylist,
    playTrack,
    play,
    pause,
    togglePlay,
    next,
    prev,
    setPlayMode,
    setCurrentIndex,
    seek,
    setVolume,
    toggleMuted,
    sampleTrack,
  }

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}
