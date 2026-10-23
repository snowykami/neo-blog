'use client'

import type { NeteaseSongProps } from './schema'
import { ExternalLinkIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { getMusicSong } from '@/api/music'
import { ProgressControl } from '@/components/common/controlled-progress'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMusic } from '@/contexts/music-context'
import { formatDurationMMSS } from '@/utils/common/datetime'
import { useCachedRequest } from '../use-cached-request'

// 没有歌词时歌词接口返回的占位文本，不在卡片中展示
const LYRIC_PLACEHOLDERS = new Set(['no_lyric', 'pure_music_without_lyric'])

/**
 * 网易云单曲卡：歌曲在博客歌单内时交给全站播放器播放（共用歌词与进度），播放中可拖动进度、显示当前歌词；
 * 不在歌单内时只展示公开信息并链接到网易云，不在站内提供播放地址
 */
export default function NeteaseSongCard({ id }: NeteaseSongProps) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const { playlist, currentTrack, isPlaying, currentTime, duration, currentLyric, playTrack, togglePlay, seek } = useMusic()
  // 拖动进度时的预览位置（百分比），松开后才真正跳转
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  // 歌单内的歌曲直接使用歌单数据，否则请求单曲公开信息
  const state = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  const song = track ?? (state.status === 'success' ? state.data : null)
  const link = song?.link || `https://music.163.com/#/song?id=${id}`
  const isCurrent = track != null && currentTrack?.id === id
  const playing = isCurrent && isPlaying
  const hasDuration = isCurrent && !!duration && Number.isFinite(duration)
  const progress = hasDuration ? Math.min(100, ((currentTime ?? 0) / duration) * 100) : 0
  const shownSeconds = hasDuration && dragPercent != null ? (dragPercent / 100) * duration : (isCurrent ? currentTime ?? 0 : 0)
  const shownTime = formatDurationMMSS(Math.floor(shownSeconds))
  const totalTime = hasDuration ? formatDurationMMSS(Math.floor(duration)) : '--:--'
  // 播放中显示当前歌词，否则显示歌手与专辑
  const lyric = playing && currentLyric && !LYRIC_PLACEHOLDERS.has(currentLyric.trim()) ? currentLyric : null

  return (
    <div className="grid gap-2.5 rounded-xl border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-3.5">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {song?.albumPic
            ? <SafeImage src={song.albumPic} alt="" fill sizes="64px" className="object-cover" />
            : state.status === 'loading' && !track && <Skeleton className="size-full" />}
        </div>
        <div className="min-w-0 flex-1">
          {song
            ? (
                <>
                  <a href={link} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold text-foreground no-underline hover:text-primary">
                    {song.name}
                  </a>
                  {/* 歌词随播放变化，key 让切换时重新淡入 */}
                  <p key={lyric ?? 'meta'} className={lyric ? 'truncate text-sm text-primary/90 animate-in fade-in-0 duration-300' : 'truncate text-sm text-muted-foreground'}>
                    {lyric ?? [song.artists.join(' / '), song.album].filter(Boolean).join(' · ')}
                  </p>
                </>
              )
            : state.status === 'error'
              ? <p className="text-sm text-muted-foreground">{t('load_failed')}</p>
              : (
                  <div className="grid gap-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3.5 w-1/3" />
                  </div>
                )}
        </div>
        {track
          ? (
              <Button
                type="button"
                size="icon"
                className="size-10 shrink-0 rounded-full"
                aria-label={t(playing ? 'pause' : 'play')}
                title={t(playing ? 'pause' : 'play')}
                onClick={() => (isCurrent ? togglePlay() : playTrack(index))}
              >
                {playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
              </Button>
            )
          : (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href={link} target="_blank" rel="noopener noreferrer" title={t('not_in_playlist')}>
                  <ExternalLinkIcon />
                  {t('open')}
                </a>
              </Button>
            )}
      </div>

      {/* 当前正在播放（或暂停在）这首歌时显示可拖动的进度 */}
      {isCurrent && (
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
          <span className="w-10 shrink-0 text-right">{shownTime}</span>
          <ProgressControl
            className="flex-1"
            value={progress}
            disabled={!hasDuration}
            step={2}
            ariaLabel={t('progress')}
            ariaValueText={`${shownTime} / ${totalTime}`}
            onChange={setDragPercent}
            onChangeEnd={(value) => {
              setDragPercent(null)
              if (hasDuration)
                seek((value / 100) * duration)
            }}
          />
          <span className="w-10 shrink-0">{totalTime}</span>
        </div>
      )}
    </div>
  )
}
