'use client'

import type { NeteaseSongProps } from './schema'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { PauseIcon, PlayIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { getCurrentLyricIndex, parseMusicLyrics } from '@/utils/music-lyric'
import { useComponentHeight } from '../use-component-height'
import { isTallMusicCard, MusicCardLyricHint, MusicCardView } from './music-card-view'

// 同一时间只播放一张自定义音频卡片
let activeAudio: HTMLAudioElement | null = null

/**
 * 自定义音频：使用卡片自己的 audio 播放，与全站播放器互斥（开始播放时暂停全站播放器，全站播放器开始播放时暂停卡片）；
 * 填写了 LRC 歌词时，播放中显示当前一行；5 单位及以上高度时在歌词区显示全部歌词
 */
export function CustomAudioCard({ title, artist, album, cover, src, lyric }: NeteaseSongProps) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const { isPlaying: globalPlaying, pause: pauseGlobal } = useMusic()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
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
    }
    const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      if (activeAudio === audio)
        activeAudio = null
      // 释放音频资源
      audio.removeAttribute('src')
      audio.load()
      setPlaying(false)
      setCurrentTime(0)
      setDuration(null)
    }
  }, [src])

  // 全站播放器开始播放时暂停卡片
  useEffect(() => {
    if (globalPlaying)
      audioRef.current?.pause()
  }, [globalPlaying])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio)
      return
    if (!audio.paused) {
      audio.pause()
      return
    }
    pauseGlobal()
    void audio.play().catch(() => {
      // 浏览器阻止播放或音频无法加载时保持暂停状态
    })
  }

  const tall = isTallMusicCard(useComponentHeight())
  const lines = useMemo(() => (lyric.trim() ? parseMusicLyrics({ lrc: { lyric, version: 1 } }).lines : []), [lyric])
  const activeIndex = lines.length > 0 ? getCurrentLyricIndex(lines, currentTime * 1000, null) : null
  const lineIndex = playing && !tall ? activeIndex : null
  const lyricText = lineIndex != null ? lines[lineIndex]?.originalText.trim() : ''

  const seek = (seconds: number) => {
    if (audioRef.current)
      audioRef.current.currentTime = seconds
    setCurrentTime(seconds)
  }

  const subtitle = lyricText
    ? <p className="truncate text-sm text-primary">{lyricText}</p>
    : <p className="truncate text-sm text-muted-foreground">{[artist, album].filter(Boolean).join(' · ')}</p>

  return (
    <MusicCardView
      cover={cover}
      title={title}
      subtitle={subtitle}
      action={(
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-full"
          aria-label={t(playing ? 'pause' : 'play')}
          title={t(playing ? 'pause' : 'play')}
          onClick={toggle}
        >
          {playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
        </Button>
      )}
      progress={{ currentTime, duration, onSeek: seek }}
      lyrics={lines.length > 0
        ? <CardLyricList lines={lines} activeIndex={activeIndex} onSeek={seek} />
        : <MusicCardLyricHint>{t('no_lyric')}</MusicCardLyricHint>}
    />
  )
}

/** 歌词区：列出全部歌词，当前行高亮并滚动到中间，点击某行跳转 */
function CardLyricList({ lines, activeIndex, onSeek }: { lines: MusicLyricLine[], activeIndex: number | null, onSeek: (seconds: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 只滚动歌词区自身，不带动页面
  useEffect(() => {
    const container = containerRef.current
    const target = activeIndex != null ? lineRefs.current[activeIndex] : null
    if (container && target)
      container.scrollTo({ top: target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2, behavior: 'smooth' })
  }, [activeIndex])

  return (
    <div
      ref={containerRef}
      className="relative grid h-full content-start gap-1 overflow-y-auto py-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)' }}
    >
      {lines.map((line, index) => (
        <button
          // 歌词行可能重复，以开始时间与下标作为 key
          key={`${line.startTime}-${index}`}
          ref={(el) => { lineRefs.current[index] = el }}
          type="button"
          className={cn(
            'rounded-md px-2 py-0.5 text-center text-sm transition-colors hover:text-foreground',
            index === activeIndex ? 'font-semibold text-primary' : 'text-muted-foreground',
          )}
          onClick={() => onSeek(line.startTime / 1000)}
        >
          {line.originalText.trim() || '\u00A0'}
        </button>
      ))}
    </div>
  )
}
