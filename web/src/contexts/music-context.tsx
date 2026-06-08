'use client'
import type { MusicLyrics } from '@/api/music'
import type { MusicTrack } from '@/models/music'
import type { MusicLyricItem, MusicLyricLine, MusicLyricMode } from '@/utils/music-lyric'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  rotateDeg: number // 专辑封面旋转角度（用于动画）
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
  replacePlaylist: (tracks: MusicTrack[], startIndex?: number) => void

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

export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingPlayRef = useRef(false)
  const prevTrackIdRef = useRef<number | null>(null)
  const [playlist, setPlaylist] = useState<MusicTrack[]>([])
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playMode, setPlayMode] = useState<PlayMode>('repeat-all')
  const [currentTime, setCurrentTime] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [bufferedPercent, setBufferedPercent] = useState<number>(0)
  const [rotateDeg, setRotateDeg] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [lyrics, setLyrics] = useState<MusicLyrics | null>(null) // 原始歌词响应
  const [currentLyric, setCurrentLyric] = useState<string | null>(null) // 当前歌词行文本
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number | null>(null) // 当前歌词行索引
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null) // 当前歌词字索引
  const [lyricLines, setLyricLines] = useState<{ time: number, text: string }[]>([]) // 解析后的歌词行列表
  const [parsedLyricLines, setParsedLyricLines] = useState<MusicLyricLine[]>([]) // 解析后的逐字歌词行
  const [translationLyricLines, setTranslationLyricLines] = useState<MusicLyricLine[]>([])
  const [romajiLyricLines, setRomajiLyricLines] = useState<MusicLyricLine[]>([])
  const [lyricMode, setLyricModeState] = useState<MusicLyricMode>('translation')
  const [lyricSourceType, setLyricSourceType] = useState<'yrc' | 'lrc' | 'none'>('none')
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
  const getAudio = useCallback(() => audioRef.current, [])

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
  // 旋转动画
  useEffect(() => {
    let rafId: number | null = null
    const rotate = () => {
      setRotateDeg(prev => (prev + 0.2) % 360)
      rafId = requestAnimationFrame(rotate)
    }
    if (isPlaying) {
      rafId = requestAnimationFrame(rotate)
    }
    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [isPlaying])

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

  // 当 currentTrack 变化时更新 audio.src和歌词（仅在 track id 变化时），并在 pendingPlay 时尝试播放
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return
    if (currentTrack) {
      // 清空旧歌词，避免切换歌曲时显示上一首的歌词
      if (prevTrackIdRef.current !== currentTrack.id) {
        setLyrics(null)
        setCurrentLyric(null)
        setCurrentLyricIndex(null)
        setCurrentWordIndex(null)
      }
      fetchNcmLyric(currentTrack.id).then((lyrics) => {
        setLyrics(lyrics)
      }).catch(() => {
        setLyrics(null)
      })
      if (prevTrackIdRef.current !== currentTrack.id) {
        audio.src = currentTrack.audio || ''
        // 不强制重置 currentTime 为 0，只有在确实为新曲目时才重置
        audio.currentTime = 0
        prevTrackIdRef.current = currentTrack.id
      }
      if (pendingPlayRef.current) {
        void audio.play().catch(() => {
          /* play 可能被浏览器阻止，事件监听会同步状态 */
        })
        pendingPlayRef.current = false
      }
    }
    else {
      audio.src = ''
      prevTrackIdRef.current = null
    }
  }, [currentTrack, currentIndex])

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

    const onLoaded = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
      // set initial currentTime
      setCurrentTime(audio.currentTime ?? 0)
      // update buffered
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
    const onTimeUpdate = () => {
      // RAF 节流，避免每帧都 setState
      const now = performance.now()
      if (now - lastTimeTick < 120) {
        if (rafId == null) {
          rafId = requestAnimationFrame(() => {
            setCurrentTime(audio.currentTime)
            lastTimeTick = performance.now()
            rafId = null
          })
        }
        return
      }
      setCurrentTime(audio.currentTime)
      lastTimeTick = now
    }
    const onProgress = () => {
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
    const onEnded = () => {
      if (playMode === 'repeat-one') {
        audio.currentTime = 0
        void audio.play().catch(() => { })
        return
      }

      // 切歌逻辑：改变 currentIndex，标记 pendingPlay 以便自动播放下一首
      setCurrentIndex((prev) => {
        if (playlist.length === 0)
          return null
        if (playMode === 'shuffle') {
          if (playlist.length === 1)
            return 0
          let idx = Math.floor(Math.random() * playlist.length)
          if (idx === prev && playlist.length > 1)
            idx = (idx + 1) % playlist.length
          pendingPlayRef.current = true
          return idx
        }
        const nextIdx = (prev == null ? 0 : prev + 1)
        pendingPlayRef.current = true
        return nextIdx >= playlist.length ? 0 : nextIdx
      })
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('progress', onProgress)
    audio.addEventListener('ended', onEnded)

    // 初始同步
    onLoaded()
    onTimeUpdate()
    onProgress()

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('progress', onProgress)
      audio.removeEventListener('ended', onEnded)
      if (rafId != null)
        cancelAnimationFrame(rafId)
    }
    // 仅依赖 playlist.length 和 mode（onEnded 使用）
  }, [playMode, playlist.length])

  // 歌词文本变化时解析为 skos-player 同风格的数据结构；YRC 可提供逐字时间，LRC 自动退化为逐行。
  useEffect(() => {
    if (!lyrics) {
      setLyricLines([])
      setParsedLyricLines([])
      setTranslationLyricLines([])
      setRomajiLyricLines([])
      setLyricSourceType('none')
      setCurrentLyric(null)
      setCurrentLyricIndex(null)
      setCurrentWordIndex(null)
      return
    }

    try {
      const parsed = parseMusicLyrics(lyrics)
      const mapped = parsed.lines.map(line => ({
        time: line.startTime / 1000,
        text: line.originalText,
      }))
      setParsedLyricLines(parsed.lines)
      setTranslationLyricLines(parsed.translationLines)
      setRomajiLyricLines(parsed.romajiLines)
      setLyricSourceType(parsed.sourceType)
      setLyricLines(mapped)
    }
    catch (error) {
      console.error('Failed to parse lyrics:', error)
      setParsedLyricLines([])
      setTranslationLyricLines([])
      setRomajiLyricLines([])
      setLyricSourceType('none')
      setLyricLines([])
    }
  }, [lyrics])

  useEffect(() => {
    if (parsedLyricLines.length === 0 || currentTime == null) {
      setCurrentLyric(null)
      setCurrentLyricIndex(null)
      setCurrentWordIndex(null)
      return
    }

    const currentTimeMs = currentTime * 1000
    const nextIndex = getCurrentLyricIndex(parsedLyricLines, currentTimeMs, currentLyricIndex)
    const line = nextIndex == null ? undefined : parsedLyricLines[nextIndex]

    setCurrentLyricIndex(nextIndex)
    setCurrentWordIndex(getCurrentWordIndex(line, currentTimeMs))
    setCurrentLyric(line?.originalText ?? null)
  }, [currentLyricIndex, parsedLyricLines, currentTime])

  // 操作函数 —— 不直接 set isPlaying/currentTime（由事件回路同步）
  const replacePlaylist = useCallback((tracks: MusicTrack[], startIndex = 0) => {
    setPlaylist(tracks)
    setCurrentIndex(tracks.length > 0 ? Math.max(0, Math.min(startIndex, tracks.length - 1)) : null)
  }, [])

  const playTrack = useCallback((index: number) => {
    if (index < 0 || index >= playlist.length)
      return
    pendingPlayRef.current = true
    setCurrentIndex(index)
  }, [playlist])

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
    setCurrentIndex((curr) => {
      if (playlist.length === 0)
        return null
      if (playMode === 'shuffle') {
        if (playlist.length === 1)
          return 0
        let idx = Math.floor(Math.random() * playlist.length)
        if (idx === curr && playlist.length > 1)
          idx = (idx + 1) % playlist.length
        pendingPlayRef.current = true
        return idx
      }
      const nextIdx = (curr == null ? 0 : curr + 1)
      pendingPlayRef.current = true
      return nextIdx >= playlist.length ? 0 : nextIdx
    })
  }, [playMode, playlist.length])

  const prev = useCallback(() => {
    setCurrentIndex((curr) => {
      if (playlist.length === 0)
        return null
      if (playMode === 'shuffle') {
        if (playlist.length === 1)
          return 0
        let idx = Math.floor(Math.random() * playlist.length)
        if (idx === curr && playlist.length > 1)
          idx = (idx + 1) % playlist.length
        pendingPlayRef.current = true
        return idx
      }
      const prevIdx = (curr == null ? playlist.length - 1 : curr - 1)
      pendingPlayRef.current = true
      return prevIdx < 0 ? playlist.length - 1 : prevIdx
    })
  }, [playMode, playlist.length])

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
    rotateDeg,
    volume,
    isMuted,
    currentLyric,
    currentLyricIndex,
    currentLyricWords: currentLyricIndex == null ? [] : parsedLyricLines[currentLyricIndex]?.items ?? [],
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
