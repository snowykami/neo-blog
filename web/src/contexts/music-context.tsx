'use client'
import type { MusicTrack } from '@/models/music'
import Lyric from 'lrc-file-parser'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { fetchNcmLyric } from '@/api/music'

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
  currentLyric: string | null
  currentLyricIndex: number | null
  lyricLines: { time: number, text: string }[]

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
  const [lyrics, setLyrics] = useState<string | null>(null) // 原始歌词文本
  const lyricRef = useRef<Lyric | null>(null) // 解析后的歌词对象
  const [currentLyric, setCurrentLyric] = useState<string | null>(null) // 当前歌词行文本
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number | null>(null) // 当前歌词行索引
  const [lyricLines, setLyricLines] = useState<{ time: number, text: string }[]>([]) // 解析后的歌词行列表
  const currentTrack = currentIndex != null ? playlist[currentIndex] ?? null : null
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
      audioRef.current = audio
    }
  }, [])

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
  }, [currentTrack])

  // 统一通过 audio 事件驱动上下文状态（isPlaying / time / duration / buffered）
  useEffect(() => {
    const audio = audioRef.current
    if (!audio)
      return

    let rafId: number | null = null
    let lastTimeTick = 0

    const onPlay = () => {
      setIsPlaying(true)
      // 同步 lyric parser：在播放开始时以当前时间启动 parser
      try {
        lyricRef.current?.play?.(audio.currentTime * 1000)
      }
      catch {}
    }
    const onPause = () => {
      setIsPlaying(false)
      try {
        lyricRef.current?.pause?.()
      }
      catch {}
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

      // 音频元数据就绪后，让 lyric parser 用当前时间同步一次（若存在）
      try {
        if (lyricRef.current) {
          // play 会根据传入时间刷新当前行回调；如果当前处于暂停则立即 pause
          lyricRef.current.play?.(audio.currentTime * 1000)
          if (audio.paused)
            lyricRef.current.pause?.()
        }
      }
      catch {}
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

  // 歌词文本变化时解析歌词
  useEffect(() => {
    // 清理旧 parser
    try {
      lyricRef.current?.pause?.()
    }
    catch {}
    lyricRef.current = null

    if (!lyrics) {
      setLyricLines([])
      setCurrentLyric(null)
      setCurrentLyricIndex(null)
      return
    }

    // 创建新的 Lyric parser 并绑定回调
    const parser = new Lyric({
      lyric: lyrics,
      onPlay: (line: number, text: string) => {
        // Lyric.onPlay 以行号和文本回调
        setCurrentLyricIndex(line)
        setCurrentLyric(text)
      },
      onSetLyric: (lines: any[]) => {
        // 将解析后的行转换为我们期望的格式
        try {
          const mapped = (lines || []).map((ln: any) => ({ time: Number(ln.time ?? 0) / 1000, text: String(ln.text ?? '') }))
          setLyricLines(mapped)
        }
        catch {
          setLyricLines([])
        }
      },
    })

    lyricRef.current = parser

    // 将 parser 与当前 audio 时间同步：触发一次解析器更新（但保持播放/暂停状态）
    const audio = audioRef.current
    if (audio) {
      try {
        parser.play?.(audio.currentTime * 1000)
        if (audio.paused)
          parser.pause?.()
      }
      catch {}
    }

    // cleanup
    return () => {
      try {
        parser.pause?.()
      }
      catch {}
    }
  }, [lyrics])

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
      // 同步歌词解析器到新时间点（用户触发的跳转）
      try {
        // Lyric 接受 ms 单位
        lyricRef.current?.play?.((Math.max(0, Math.min(seconds, audio.duration || seconds))) * 1000)
        if (audio.paused)
          lyricRef.current?.pause?.()
      }
      catch {}
    }
    catch {
    }
  }, [])

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current
    if (!audio)
      return
    audio.volume = Math.max(0, Math.min(1, v))
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
    currentLyric,
    currentLyricIndex,
    lyricLines,
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
    sampleTrack,
  }

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}
