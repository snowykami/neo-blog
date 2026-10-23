'use client'

import type { NeteaseSongProps } from './schema'
import { ExternalLinkIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getMusicSong } from '@/api/music'
import { LyricLine } from '@/components/common/music-lyric-line'
import LyricScroll from '@/components/common/music-lyric-scroll'
import { Button } from '@/components/ui/button'
import { useMusic } from '@/contexts/music-context'
import { useCachedRequest } from '../use-cached-request'
import { useComponentHeight } from '../use-component-height'
import { CustomAudioCard } from './custom-audio-card'
import { isTallMusicCard, MusicCardLyricHint, MusicCardView } from './music-card-view'

// 没有歌词时歌词接口返回的占位文本，不在卡片中展示
const LYRIC_PLACEHOLDERS = new Set(['no_lyric', 'pure_music_without_lyric'])

/** 音乐卡片：网易云歌曲或自定义音频 */
export default function MusicCard(props: NeteaseSongProps) {
  return props.mode === 'custom' ? <CustomAudioCard {...props} /> : <NeteaseSongCard id={props.id} />
}

/**
 * 网易云单曲：歌曲在博客歌单内时交给全站播放器播放（共用歌词与进度），播放中可拖动进度、显示当前歌词；
 * 不在歌单内时只展示公开信息并链接到网易云，不在站内提供播放地址
 */
function NeteaseSongCard({ id }: { id: number }) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const { playlist, currentTrack, isPlaying, currentTime, duration, currentLyric, playTrack, togglePlay, seek } = useMusic()
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  // 歌单内的歌曲直接使用歌单数据，否则请求单曲公开信息
  const state = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  const song = track ?? (state.status === 'success' ? state.data : null)
  const link = song?.link || `https://music.163.com/#/song?id=${id}`
  const isCurrent = track != null && currentTrack?.id === id
  const playing = isCurrent && isPlaying
  // 5 单位及以上高度时歌词显示在歌词区（与播放器面板共用滚动歌词），副标题固定显示歌手与专辑
  const tall = isTallMusicCard(useComponentHeight())
  // 播放中显示当前歌词（与导航栏共用逐字高亮与超长滚动），否则显示歌手与专辑
  const showLyric = !tall && playing && !!currentLyric && !LYRIC_PLACEHOLDERS.has(currentLyric.trim())

  const subtitle = !song
    ? state.status === 'error' && <p className="text-sm text-muted-foreground">{t('load_failed')}</p>
    : showLyric
      ? <div className="text-sm"><LyricLine /></div>
      : <p className="truncate text-sm text-muted-foreground">{[song.artists.join(' / '), song.album].filter(Boolean).join(' · ')}</p>

  const action = track
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
      )

  return (
    <MusicCardView
      cover={song?.albumPic}
      title={song?.name}
      href={link}
      subtitle={subtitle}
      action={action}
      loading={!song && state.status === 'loading'}
      lyrics={isCurrent
        ? <LyricScroll className="h-full" />
        : song && <MusicCardLyricHint>{t(track ? 'lyric_idle' : 'not_in_playlist')}</MusicCardLyricHint>}
      // 当前正在播放（或暂停在）这首歌时显示可拖动的进度
      progress={isCurrent ? { currentTime: currentTime ?? 0, duration, onSeek: seek } : null}
    />
  )
}
