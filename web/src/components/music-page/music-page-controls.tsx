'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PlayMode } from '@/contexts/music-context'
import { CaseSensitiveIcon, LanguagesIcon, ListMusicIcon, PauseIcon, PlayIcon, Repeat1Icon, RepeatIcon, ShuffleIcon, SkipBackIcon, SkipForwardIcon, SparklesIcon, Volume1Icon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { ProgressControl } from '@/components/common/controlled-progress'
import { getNextPlayMode, useMusic, useMusicClock } from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'

const PLAY_MODE_ICONS: Record<PlayMode, LucideIcon> = {
  'repeat-all': RepeatIcon,
  'repeat-one': Repeat1Icon,
  'shuffle': ShuffleIcon,
}

/** 播放器页图标按钮的样式（悬浮播放器里的链接按钮也使用） */
export const MUSIC_ICON_BUTTON_CLASSNAME = 'inline-flex shrink-0 items-center justify-center rounded-full p-2 text-white/70 transition-[color,background-color,transform] hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:text-white/25'

/** 播放器页上的图标按钮：白色图标，激活时高亮，禁用时变暗 */
function IconButton({ icon: Icon, label, onClick, active, disabled, className, iconClassName }: {
  icon: LucideIcon
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  className?: string
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        MUSIC_ICON_BUTTON_CLASSNAME,
        active && 'text-white',
        className,
      )}
    >
      <Icon aria-hidden className={cn('size-5', iconClassName)} />
    </button>
  )
}

/** 进度条与时间：订阅播放时钟（约每秒 4 次），拖动时显示预览时间、松手后跳转；网易云标出的副歌片段在进度条上标出 */
function ProgressRow() {
  const t = useTranslations('MusicPage')
  const { duration, seek, currentTrack } = useMusic()
  const chorus = useSongChorus(currentTrack?.id ?? null)
  const currentTime = useMusicClock()
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const total = duration && Number.isFinite(duration) ? duration : 0
  const shownSeconds = total > 0 && dragPercent != null ? (dragPercent / 100) * total : currentTime
  const value = dragPercent ?? (total > 0 ? Math.min(100, (currentTime / total) * 100) : 0)
  const shownTime = formatDurationMMSS(Math.floor(shownSeconds))
  const totalTime = total > 0 ? formatDurationMMSS(Math.floor(total)) : '--:--'
  const marks = useMemo(() => total > 0
    ? chorus.map(item => ({ start: Math.min(100, item.start / 10 / total), end: Math.min(100, item.end / 10 / total) }))
    : [], [chorus, total])

  return (
    <div className="grid gap-1.5">
      <ProgressControl
        value={value}
        disabled={total <= 0}
        step={2}
        ariaLabel={t('progress')}
        ariaValueText={`${shownTime} / ${totalTime}`}
        marks={marks}
        onChange={setDragPercent}
        onChangeEnd={(next) => {
          setDragPercent(null)
          if (total > 0)
            seek((next / 100) * total)
        }}
      />
      <div className="flex justify-between text-xs font-medium text-white/60 tabular-nums">
        <span>{shownTime}</span>
        <span>{totalTime}</span>
      </div>
    </div>
  )
}

/** 音量：静音按钮 + 音量条（窄屏与紧凑模式只保留静音按钮） */
function VolumeControl({ compact }: { compact: boolean }) {
  const t = useTranslations('MusicPage')
  const playerT = useTranslations('MusicPlayer')
  const { volume, isMuted, setVolume, toggleMuted } = useMusic()
  const muted = isMuted || volume === 0
  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        icon={muted ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon}
        label={playerT(isMuted ? 'unmute' : 'mute')}
        active={isMuted}
        onClick={toggleMuted}
      />
      <div className={cn('hidden w-24 shrink-0', !compact && 'sm:block')}>
        <ProgressControl
          value={muted ? 0 : volume * 100}
          step={5}
          ariaLabel={t('volume')}
          ariaValueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
          onChange={(next) => {
            setVolume(next / 100)
            if (isMuted && next > 0)
              toggleMuted()
          }}
        />
      </div>
    </div>
  )
}

/**
 * 播放器页控制栏：进度、上一首 / 播放 / 下一首、播放模式、音量、翻译与音译开关、歌单。
 * compact 为悬浮播放器使用的紧凑模式：布局相同，按钮更小、间距更紧
 */
export function MusicPageControls({ onOpenPlaylist, playlistSlot, compact = false, className }: {
  onOpenPlaylist?: () => void
  // 替换歌单按钮（悬浮播放器使用自己的小歌单弹层）
  playlistSlot?: ReactNode
  compact?: boolean
  className?: string
}) {
  const t = useTranslations('MusicPage')
  const playerT = useTranslations('MusicPlayer')
  const {
    isPlaying,
    togglePlay,
    prev,
    next,
    playMode,
    setPlayMode,
    showTranslation,
    showRomaji,
    setShowTranslation,
    setShowRomaji,
    hasTranslationLyric,
    hasRomajiLyric,
    showLyricEffects,
    setShowLyricEffects,
  } = useMusic()

  return (
    <div className={cn('grid', compact ? 'gap-2' : 'gap-4', className)}>
      <ProgressRow />
      <div className={cn('flex items-center', compact ? 'justify-between' : 'justify-center gap-3 sm:gap-5')}>
        <IconButton icon={PLAY_MODE_ICONS[playMode]} label={playerT(`play_mode_${playMode}`)} onClick={() => setPlayMode(getNextPlayMode(playMode))} />
        <IconButton icon={SkipBackIcon} label={playerT('previous')} onClick={prev} iconClassName={cn(compact ? 'size-5' : 'size-7', 'fill-current')} />
        <button
          type="button"
          aria-label={playerT(isPlaying ? 'pause' : 'play')}
          title={playerT(isPlaying ? 'pause' : 'play')}
          onClick={togglePlay}
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none active:scale-95',
            compact ? 'size-11' : 'size-16',
          )}
        >
          {isPlaying
            ? <PauseIcon aria-hidden className={cn(compact ? 'size-5' : 'size-7', 'fill-current')} />
            : <PlayIcon aria-hidden className={cn(compact ? 'size-5' : 'size-7', 'translate-x-0.5 fill-current')} />}
        </button>
        <IconButton icon={SkipForwardIcon} label={playerT('next')} onClick={next} iconClassName={cn(compact ? 'size-5' : 'size-7', 'fill-current')} />
        {playlistSlot ?? <IconButton icon={ListMusicIcon} label={t('open_playlist')} onClick={() => onOpenPlaylist?.()} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <VolumeControl compact={compact} />
        <div className="flex items-center gap-1">
          <IconButton
            icon={LanguagesIcon}
            label={hasTranslationLyric ? playerT('show_translation') : playerT('no_extra_lyric')}
            active={hasTranslationLyric && showTranslation}
            disabled={!hasTranslationLyric}
            onClick={() => setShowTranslation(!showTranslation)}
          />
          <IconButton
            icon={SparklesIcon}
            label={playerT('show_lyric_effects')}
            active={showLyricEffects}
            onClick={() => setShowLyricEffects(!showLyricEffects)}
          />
          <IconButton
            icon={CaseSensitiveIcon}
            label={hasRomajiLyric ? playerT('show_romaji') : playerT('no_extra_lyric')}
            active={hasRomajiLyric && showRomaji}
            disabled={!hasRomajiLyric}
            onClick={() => setShowRomaji(!showRomaji)}
          />
        </div>
      </div>
    </div>
  )
}
