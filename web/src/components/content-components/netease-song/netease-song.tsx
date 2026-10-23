'use client'

import type { NeteaseSongProps } from './schema'
import { ExternalLinkIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getMusicSong } from '@/api/music'
import { SafeImage } from '@/components/common/safe-image'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMusic } from '@/contexts/music-context'
import { useCachedRequest } from '../use-cached-request'

/**
 * 网易云单曲卡：歌曲在博客歌单内时交给全站播放器播放（共用歌词与进度）；
 * 不在歌单内时只展示公开信息并链接到网易云，不在站内提供播放地址
 */
export default function NeteaseSongCard({ id }: NeteaseSongProps) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const { playlist, currentTrack, isPlaying, currentTime, duration, playTrack, togglePlay } = useMusic()
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  // 歌单内的歌曲直接使用歌单数据，否则请求单曲公开信息
  const state = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  const song = track ?? (state.status === 'success' ? state.data : null)
  const link = song?.link || `https://music.163.com/#/song?id=${id}`
  const isCurrent = track != null && currentTrack?.id === id
  const playing = isCurrent && isPlaying
  const progress = isCurrent && duration ? Math.min(100, ((currentTime ?? 0) / duration) * 100) : 0

  return (
    <div className="relative flex items-center gap-3.5 overflow-hidden rounded-xl border bg-card p-3 text-card-foreground">
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
                <p className="truncate text-sm text-muted-foreground">
                  {[song.artists.join(' / '), song.album].filter(Boolean).join(' · ')}
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
      {isCurrent && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}
