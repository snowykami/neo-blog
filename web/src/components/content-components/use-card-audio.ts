'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMusic } from '@/contexts/music-context'

// 文章内多个自定义音频（音乐卡片、歌词摘录）共用：同一时间只播放一个
let activeAudio: HTMLAudioElement | null = null

/** idle：未播放；loading：已点击播放、正在缓冲；playing：播放中；error：音频无法加载（再次点击会重试） */
export type CardAudioStatus = 'idle' | 'loading' | 'playing' | 'error'

/**
 * 卡片自带的音频播放（自定义音频的音乐卡片与歌词摘录共用）：
 * - 与全站播放器互斥：开始播放时暂停全站播放器，全站播放器开始播放时暂停卡片
 * - 同一时间只播放一张卡片
 * - 区分缓冲中与加载失败，失败后再次播放会重新加载
 */
export function useCardAudio(src: string) {
  const { isPlaying: globalPlaying, pause: pauseGlobal } = useMusic()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = src
    audioRef.current = audio
    const onTime = () => setCurrentTime(audio.currentTime)
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : null)
    const onPlay = () => {
      if (activeAudio && activeAudio !== audio)
        activeAudio.pause()
      activeAudio = audio
      setPlaying(true)
      setFailed(false)
    }
    const onPlaying = () => setWaiting(false)
    const onWaiting = () => setWaiting(true)
    const onPause = () => {
      setPlaying(false)
      setWaiting(false)
    }
    const onError = () => {
      setFailed(true)
      setPlaying(false)
      setWaiting(false)
    }
    const events: [string, () => void][] = [
      ['timeupdate', onTime],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['play', onPlay],
      ['playing', onPlaying],
      ['waiting', onWaiting],
      ['pause', onPause],
      ['ended', onPause],
      ['error', onError],
    ]
    events.forEach(([type, handler]) => audio.addEventListener(type, handler))
    return () => {
      audio.pause()
      events.forEach(([type, handler]) => audio.removeEventListener(type, handler))
      if (activeAudio === audio)
        activeAudio = null
      // 释放音频资源
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
      setPlaying(false)
      setWaiting(false)
      setFailed(false)
      setCurrentTime(0)
      setDuration(null)
    }
  }, [src])

  // 全站播放器开始播放时暂停卡片
  useEffect(() => {
    if (globalPlaying)
      audioRef.current?.pause()
  }, [globalPlaying])

  /** 开始播放；传入 fromSeconds 时从该位置播放 */
  const play = useCallback((fromSeconds?: number) => {
    const audio = audioRef.current
    if (!audio)
      return
    pauseGlobal()
    // 上次加载失败（地址暂时不可用等）时重新加载再播放
    if (failed) {
      setFailed(false)
      audio.load()
    }
    if (fromSeconds != null) {
      try {
        audio.currentTime = fromSeconds
      }
      catch {}
    }
    setWaiting(true)
    void audio.play().catch((error: unknown) => {
      setWaiting(false)
      // 浏览器阻止自动播放、或播放被新的加载打断时保持暂停；其余（地址无效、格式不支持）视为加载失败
      const name = error instanceof DOMException ? error.name : ''
      if (name !== 'NotAllowedError' && name !== 'AbortError')
        setFailed(true)
    })
  }, [failed, pauseGlobal])

  const pause = useCallback(() => audioRef.current?.pause(), [])

  /** 跳转到指定位置；play 为 true 时同时开始播放（如点击某句歌词） */
  const seek = useCallback((seconds: number, { play: andPlay = false }: { play?: boolean } = {}) => {
    const audio = audioRef.current
    if (!audio)
      return
    if (andPlay && audio.paused) {
      play(seconds)
    }
    else {
      try {
        audio.currentTime = seconds
      }
      catch {}
    }
    setCurrentTime(seconds)
  }, [play])

  const getTime = useCallback(() => audioRef.current?.currentTime ?? null, [])

  const status: CardAudioStatus = failed ? 'error' : waiting ? 'loading' : playing ? 'playing' : 'idle'

  return { status, playing, currentTime, duration, play, pause, seek, getTime }
}
