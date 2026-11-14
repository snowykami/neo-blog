'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import type { PlayMode } from '@/contexts/music-context'
import {
  CaseSensitiveIcon,
  CheckIcon,
  CopyIcon,
  LanguagesIcon,
  ListMusicIcon,
  Loader2Icon,
  MessageSquareQuoteIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SparklesIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { AnimatePresence, LazyMotion, m } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TbHdr } from 'react-icons/tb'
import { toast } from 'sonner'
import { ProgressControl } from '@/components/common/controlled-progress'
import {
  getNextPlayMode,
  useMusicActions,
  useMusicClock,
  useMusicLyrics,
  useMusicPlayback,
  useMusicPreferences,
  useMusicVolume,
} from '@/contexts/music-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { useHdrDisplay } from '@/hooks/use-hdr-highlight'
import { getLyricLineText } from '@/lib/lyrics/line-utils'
import { getMotionFeatures } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'

const PLAY_MODE_ICONS: Record<PlayMode, LucideIcon> = {
  'repeat-all': RepeatIcon,
  'repeat-one': Repeat1Icon,
  'shuffle': ShuffleIcon,
}

/**
 * 播放器页图标按钮的样式（悬浮播放器里的链接按钮也使用）。
 * 触屏（pointer-coarse）上从 36px 加大到 40px，配合第二排加大的间距（4px → 6px），不容易点到隔壁。
 * 不再加大：第二排共 6 个按钮，320px 宽的手机上悬浮播放器（内容区约 272px）正好放下
 */
export const MUSIC_ICON_BUTTON_CLASSNAME = 'inline-flex shrink-0 items-center justify-center rounded-full p-2 pointer-coarse:p-2.5 text-white/70 transition-[color,background-color,transform] hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:text-white/15'

/**
 * 播放器页上的图标按钮：白色图标，禁用时变暗。
 * 传了 active 的是开关（翻译、罗马音、HDR 等）：开启时纯白，关闭时明显变暗，两种状态一眼能分清
 */
function IconButton({ icon: Icon, label, onClick, active, disabled, busy, className, iconClassName }: {
  icon: LucideIcon | IconType
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  // 忙碌态（上一首 / 下一首在等歌单补全）：图标换成转圈，按钮仍可点
  busy?: boolean
  className?: string
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        MUSIC_ICON_BUTTON_CLASSNAME,
        active === true && 'text-white',
        active === false && 'text-white/35',
        className,
      )}
    >
      {busy
        ? <Loader2Icon aria-hidden className={cn('size-5', iconClassName, 'animate-spin fill-none')} />
        : <Icon aria-hidden className={cn('size-5', iconClassName)} />}
    </button>
  )
}

/** 进度条与时间：订阅播放时钟（约每秒 4 次），拖动时显示预览时间、松手后跳转；网易云标出的副歌片段在进度条上标出 */
function ProgressRow() {
  const t = useTranslations('MusicPage')
  const { duration, currentTrack } = useMusicPlayback()
  const { seek } = useMusicActions()
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
  const { volume, isMuted, setVolume, toggleMuted } = useMusicVolume()
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

interface MoreControlsMenuProps {
  showLyricMoments: boolean
  setShowLyricMoments: (val: boolean) => void
  showLyricEffects: boolean
  setShowLyricEffects: (val: boolean) => void
  hdr: boolean
  setHdr: (val: boolean) => void
  hdrDisplay: boolean
  currentTrack: ReturnType<typeof useMusicPlayback>['currentTrack']
  lyricLines: ReturnType<typeof useMusicLyrics>['lyricLines']
}

/**
 * 更多控制项：复制歌词、评论与旁白、歌词特效、HDR 高光。
 * 收拢为三点菜单，点击后以二阶弹簧物理动效（Spring）展开半透明浮层，
 * 无操作时自动延时平滑收起。
 */
export function MoreControlsMenu({
  showLyricMoments,
  setShowLyricMoments,
  showLyricEffects,
  setShowLyricEffects,
  hdr,
  setHdr,
  hdrDisplay,
  currentTrack,
  lyricLines,
}: MoreControlsMenuProps) {
  const playerT = useTranslations('MusicPlayer')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = useCallback((delayMs = 4500) => {
    if (timerRef.current)
      clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setOpen(false)
    }, delayMs)
  }, [])

  const cancelClose = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (open)
      scheduleClose(4500)
    else
      cancelClose()
    return () => cancelClose()
  }, [open, scheduleClose, cancelClose])

  useEffect(() => {
    if (!open)
      return
    const onPointerDownOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDownOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleCopyLyrics = useCallback(async () => {
    if (!lyricLines || lyricLines.length === 0) {
      toast.error(playerT('no_lyrics_to_copy'))
      return
    }

    const title = currentTrack?.name ?? ''
    const artists = currentTrack?.artists
      ? (Array.isArray(currentTrack.artists) ? currentTrack.artists.join(' / ') : currentTrack.artists)
      : ''
    const header = title ? `${title}${artists ? ` - ${artists}` : ''}\n\n` : ''

    const content = lyricLines.map((line) => {
      const orig = getLyricLineText(line).trim()
      if (!orig)
        return ''
      const parts = [orig]
      if (line.romanization?.trim())
        parts.push(line.romanization.trim())
      if (line.translation?.trim())
        parts.push(line.translation.trim())
      return parts.join('\n')
    }).filter(Boolean).join('\n\n')

    const fullText = (header + content).trim()
    if (!fullText) {
      toast.error(playerT('no_lyrics_to_copy'))
      return
    }

    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      toast.success(playerT('lyrics_copied'))
      setTimeout(setCopied, 2000, false)
      scheduleClose(1500)
    }
    catch {
      toast.error(playerT('no_lyrics_to_copy'))
    }
  }, [currentTrack, lyricLines, playerT, scheduleClose])

  return (
    // 控制栏在播放器页和悬浮球里处于顶栏 <LazyMotion> 外部，需要自备特征包驱动 <m.div>
    <LazyMotion features={getMotionFeatures()} strict>
      <div
        ref={containerRef}
        className="relative flex items-center"
        onMouseEnter={cancelClose}
        onMouseLeave={() => open && scheduleClose(3000)}
      >
        <AnimatePresence>
          {open && (
            <m.div
              role="group"
              aria-label={playerT('more_options')}
              initial={{ opacity: 0, scale: 0.82, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 6 }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 26,
                mass: 0.75,
              }}
              className="absolute right-0 bottom-full z-30 mb-2 flex origin-bottom-right items-center gap-1 rounded-full border border-white/15 bg-neutral-950/85 p-1 shadow-2xl backdrop-blur-xl pointer-coarse:gap-1.5"
            >
              {/* 复制整首歌词 + 翻译 + 拼音 */}
              <IconButton
                icon={copied ? CheckIcon : CopyIcon}
                label={copied ? playerT('lyrics_copied') : playerT('copy_lyrics')}
                active={copied}
                iconClassName={copied ? 'text-emerald-400' : undefined}
                onClick={handleCopyLyrics}
              />

              {/* 评论与旁白 */}
              <IconButton
                icon={MessageSquareQuoteIcon}
                label={playerT('show_lyric_moments')}
                active={showLyricMoments}
                onClick={() => {
                  setShowLyricMoments(!showLyricMoments)
                  scheduleClose(2500)
                }}
              />

              {/* 歌词特效 */}
              <IconButton
                icon={SparklesIcon}
                label={playerT('show_lyric_effects')}
                active={showLyricEffects}
                onClick={() => {
                  setShowLyricEffects(!showLyricEffects)
                  scheduleClose(2500)
                }}
              />

              {/* HDR 高光 */}
              <IconButton
                icon={TbHdr}
                label={hdrDisplay ? playerT('hdr_highlight') : playerT('hdr_unsupported')}
                active={hdrDisplay && hdr}
                disabled={!hdrDisplay}
                onClick={() => {
                  setHdr(!hdr)
                  scheduleClose(2500)
                }}
              />
            </m.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          aria-label={playerT('more_options')}
          title={playerT('more_options')}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen(prev => !prev)}
          className={cn(MUSIC_ICON_BUTTON_CLASSNAME, open && 'bg-white/15 text-white')}
        >
          <MoreHorizontalIcon aria-hidden className={cn('size-5 transition-transform duration-200', open && 'rotate-90')} />
        </button>
      </div>
    </LazyMotion>
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
  const { isPlaying, pendingStep, playMode, currentTrack } = useMusicPlayback()
  const { canToggleTranslation, lyricTranslationsGenerating, canToggleRomaji, lyricPronunciationsGenerating, lyricLines } = useMusicLyrics()
  const {
    showTranslation,
    showRomaji,
    setShowTranslation,
    setShowRomaji,
    showLyricEffects,
    setShowLyricEffects,
    showLyricMoments,
    setShowLyricMoments,
    hdr,
    setHdr,
  } = useMusicPreferences()
  const { togglePlay, prev, next, setPlayMode } = useMusicActions()
  const hdrDisplay = useHdrDisplay()

  return (
    <div className={cn('grid', compact ? 'gap-2' : 'gap-4', className)}>
      <ProgressRow />
      <div className={cn('flex items-center', compact ? 'justify-between' : 'justify-center gap-3 sm:gap-5')}>
        <IconButton icon={PLAY_MODE_ICONS[playMode]} label={playerT(`play_mode_${playMode}`)} onClick={() => setPlayMode(getNextPlayMode(playMode))} />
        <IconButton icon={SkipBackIcon} label={playerT('previous')} onClick={prev} busy={pendingStep === -1} iconClassName={cn(compact ? 'size-5' : 'size-7', 'fill-current')} />
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
        <IconButton icon={SkipForwardIcon} label={playerT('next')} onClick={next} busy={pendingStep === 1} iconClassName={cn(compact ? 'size-5' : 'size-7', 'fill-current')} />
        {playlistSlot ?? <IconButton icon={ListMusicIcon} label={t('open_playlist')} onClick={() => onOpenPlaylist?.()} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        <VolumeControl compact={compact} />
        {/* 次要按钮：保留高频的翻译与读音，其余收纳为二阶弹簧三点菜单 */}
        <div className="flex items-center gap-1 pointer-coarse:gap-1.5">
          <IconButton
            icon={LanguagesIcon}
            label={lyricTranslationsGenerating ? playerT('translating_lyric') : canToggleTranslation ? playerT('show_translation') : playerT('no_extra_lyric')}
            active={canToggleTranslation && showTranslation}
            disabled={!canToggleTranslation}
            busy={lyricTranslationsGenerating}
            onClick={() => setShowTranslation(!showTranslation)}
          />
          <IconButton
            icon={CaseSensitiveIcon}
            label={lyricPronunciationsGenerating ? playerT('generating_romaji') : canToggleRomaji ? playerT('show_romaji') : playerT('no_extra_lyric')}
            active={canToggleRomaji && showRomaji}
            disabled={!canToggleRomaji}
            busy={lyricPronunciationsGenerating}
            onClick={() => setShowRomaji(!showRomaji)}
          />
          <MoreControlsMenu
            showLyricMoments={showLyricMoments}
            setShowLyricMoments={setShowLyricMoments}
            showLyricEffects={showLyricEffects}
            setShowLyricEffects={setShowLyricEffects}
            hdr={hdr}
            setHdr={setHdr}
            hdrDisplay={hdrDisplay}
            currentTrack={currentTrack}
            lyricLines={lyricLines}
          />
        </div>
      </div>
    </div>
  )
}
