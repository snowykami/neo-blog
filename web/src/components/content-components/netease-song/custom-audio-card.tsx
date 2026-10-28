'use client'

import type { NeteaseSongProps } from './schema'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { getCurrentLyricIndex, parseMusicLyrics } from '@/utils/music-lyric'
import { cleanLyricLines } from '../lyric-quote/quote-lines'
import { useCardAudio } from '../use-card-audio'
import { useComponentHeight } from '../use-component-height'
import { isTallMusicCard, MusicCardLyricHint, MusicCardView } from './music-card-view'
import { MusicPlayButton } from './music-controls'

/**
 * 自定义音频：使用卡片自己的 audio 播放，与全站播放器互斥；
 * 填写了 LRC 歌词时，播放中显示当前一行；5 单位及以上高度时在歌词区显示全部歌词
 */
export function CustomAudioCard({ title, artist, album, cover, src, lyric }: NeteaseSongProps) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const audio = useCardAudio(src)
  const { status, playing, currentTime, duration } = audio

  const tall = isTallMusicCard(useComponentHeight())
  // 与歌词摘录一致：去掉作词、作曲等署名行
  const lines = useMemo(() => (lyric.trim() ? cleanLyricLines(parseMusicLyrics({ lrc: { lyric, version: 1 } }).lines) : []), [lyric])
  // 还没开始播放时不高亮任何一句
  const started = playing || currentTime > 0
  const activeIndex = started && lines.length > 0 ? getCurrentLyricIndex(lines, currentTime * 1000, null) : null
  const lyricText = playing && !tall && activeIndex != null ? lines[activeIndex]?.originalText.trim() : ''

  // 与网易云模式一致：标题为歌名，副标题为「艺人 · 专辑」，播放中换成当前歌词；无法加载时提示
  const subtitle = status === 'error'
    ? <p className="truncate text-sm text-destructive">{t('audio_error')}</p>
    : lyricText
      ? <p className="truncate text-sm text-primary">{lyricText}</p>
      : <p className="truncate text-sm text-muted-foreground">{[artist, album].filter(Boolean).join(' · ')}</p>

  return (
    <MusicCardView
      cover={cover}
      title={title}
      subtitle={subtitle}
      action={<MusicPlayButton status={status} onClick={() => (playing ? audio.pause() : audio.play())} />}
      // 卡片自带 audio：进度行常显示，时长未就绪时不可拖拽
      progress={{ active: true, currentTime, duration, onSeek: audio.seek }}
      lyrics={lines.length > 0
        ? <CardLyricList lines={lines} activeIndex={activeIndex} onSelect={seconds => audio.seek(seconds, { play: true })} />
        : <MusicCardLyricHint>{t('no_lyric')}</MusicCardLyricHint>}
    />
  )
}

/** 歌词区：列出全部歌词，当前行高亮并滚动到中间，点击某行从该句开始播放（与全站播放器的歌词面板一致） */
function CardLyricList({ lines, activeIndex, onSelect }: { lines: MusicLyricLine[], activeIndex: number | null, onSelect: (seconds: number) => void }) {
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
      className="relative grid h-full content-start gap-0.5 overflow-y-auto py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)' }}
    >
      {lines.map((line, index) => (
        <button
          // 歌词行可能重复，以开始时间与下标作为 key
          key={`${line.startTime}-${index}`}
          ref={(el) => { lineRefs.current[index] = el }}
          type="button"
          className={cn(
            'rounded-md px-2 py-px text-center text-sm transition-colors hover:text-foreground',
            index === activeIndex ? 'font-semibold text-primary' : 'text-muted-foreground',
          )}
          onClick={() => onSelect(line.startTime / 1000)}
        >
          {line.originalText.trim() || '\u00A0'}
        </button>
      ))}
    </div>
  )
}
