'use client'

import type { NeteaseSongProps } from './schema'
import { useTranslations } from 'next-intl'
import { getMusicSong } from '@/api/music'
import { LyricLine } from '@/components/common/music-lyric-line'
import { MusicLyricStage } from '@/components/music-page/music-lyric-stage'
import { useCurrentLyric, useMusic, useMusicClock } from '@/contexts/music-context'
import { songToTrack } from '@/models/music'
import { LYRIC_PLACEHOLDERS } from '@/utils/music-lyric'
import { useCachedRequest } from '../use-cached-request'
import { useComponentHeight } from '../use-component-height'
import { CustomAudioCard } from './custom-audio-card'
import { isTallMusicCard, MusicCardLyricHint, MusicCardView } from './music-card-view'
import { MusicPlayButton, NeteaseOpenButton } from './music-controls'

/** 音乐卡片：网易云歌曲或自定义音频 */
export default function MusicCard(props: NeteaseSongProps) {
  return props.mode === 'custom' ? <CustomAudioCard {...props} /> : <NeteaseSongCard id={props.id} />
}

/**
 * 网易云单曲：歌曲在博客歌单内时交给全站播放器播放（共用歌词与进度），播放中可拖动进度、显示当前歌词；
 * 不在歌单内但可以在站内播放时（公开文章引用的歌曲、登录的管理员与编辑，由后端白名单判断），点播放时插到当前曲目之后播放；
 * 都不满足时只展示公开信息并链接到网易云，不在站内提供播放地址
 */
function NeteaseSongCard({ id }: { id: number }) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const { playlist, currentTrack, isPlaying, duration, playTrack, playSong, togglePlay, seek } = useMusic()
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  // 歌单内的歌曲直接使用歌单数据，否则请求单曲公开信息
  const state = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  const song = track ?? (state.status === 'success' ? state.data : null)
  const link = song?.link || `https://music.163.com/#/song?id=${id}`
  // 不在歌单内的歌曲由后端判断能否在站内播放
  const fetched = !track && state.status === 'success' ? state.data : null
  const playable = track != null || !!fetched?.playable
  const isCurrent = track != null && currentTrack?.id === id
  // 只有卡片对应的曲目正在全站播放器中时才订阅播放进度，其余卡片不随进度重渲染
  const currentTime = useMusicClock(isCurrent)
  const playing = isCurrent && isPlaying
  // 5 单位及以上高度时歌词显示在歌词区（与播放器页同一套歌词引擎的紧凑模式），副标题固定显示歌手与专辑
  const tall = isTallMusicCard(useComponentHeight())
  // 播放中显示当前歌词（与导航栏共用逐字高亮与超长滚动），否则显示歌手与专辑
  // 只有正在播放这张卡片的歌曲时才订阅当前歌词行
  const currentLyric = useCurrentLyric(!tall && playing)
  const showLyric = !tall && playing && !!currentLyric && !LYRIC_PLACEHOLDERS.has(currentLyric.trim())

  const subtitle = !song
    ? state.status === 'error' && <p className="text-sm text-muted-foreground">{t('load_failed')}</p>
    : showLyric
      ? <div className="text-sm"><LyricLine /></div>
      : <p className="truncate text-sm text-muted-foreground">{[song.artists.join(' / '), song.album].filter(Boolean).join(' · ')}</p>

  const action = track
    ? <MusicPlayButton status={playing ? 'playing' : 'idle'} onClick={() => (isCurrent ? togglePlay() : playTrack(index))} />
    : fetched?.playable
      ? <MusicPlayButton status="idle" onClick={() => playSong(songToTrack(fetched))} />
      : <NeteaseOpenButton href={link} />

  return (
    <MusicCardView
      cover={song?.albumPic}
      title={song?.name}
      href={link}
      subtitle={subtitle}
      action={action}
      loading={!song && state.status === 'loading'}
      lyrics={isCurrent
        ? <MusicLyricStage compact themed className="h-full" />
        : song && <MusicCardLyricHint>{t(playable ? 'lyric_idle' : 'not_in_playlist')}</MusicCardLyricHint>}
      // 进度行常显示（不是当前曲目时不可拖动，但显示歌单中的时长），避免开始播放后才出现进度行把卡片撑开；
      // 不在歌单内的歌曲不能播放，在进度行的位置直接说明原因（触屏设备看不到按钮的 title）
      progress={playable
        ? { active: isCurrent, currentTime, duration: isCurrent ? duration : (song?.duration ?? 0) / 1000 || null, onSeek: seek }
        : null}
      note={song && !playable && t('not_in_playlist_short')}
    />
  )
}
