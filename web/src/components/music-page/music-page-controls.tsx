'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'
import type { MusicLyricTranslationLangStatus } from '@/api/music'
import type { PlayMode } from '@/contexts/music-context'
import type { LyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import type { LyricTargetLang } from '@/lib/lyrics/target-lang'
import {
  CaseSensitiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GlobeIcon,
  LanguagesIcon,
  ListMusicIcon,
  Loader2Icon,
  MessageSquareQuoteIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  RepeatIcon,
  RotateCwIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SparklesIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { AnimatePresence, LazyMotion, m } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TbHdr } from 'react-icons/tb'
import { toast } from 'sonner'
import { ProgressControl } from '@/components/common/controlled-progress'
import { PLAYER_STYLE } from '@/components/common/music-player-shared'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/contexts/auth-context'
import { refreshTranslations, requestLyricTranslationLanguages } from '@/contexts/lyric-translations'
import {
  getNextPlayMode,
  useMusicActions,
  useMusicClock,
  useMusicLyrics,
  useMusicPlayback,
  useMusicPreferences,
  useMusicVolume,
} from '@/contexts/music-context'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useSongChorus } from '@/contexts/song-chorus'
import { useHdrDisplay } from '@/hooks/use-hdr-highlight'
import { getLyricLineText } from '@/lib/lyrics/line-utils'
import { canAdminAiTranslateLyrics, toggleLyricTranslationSelection } from '@/lib/lyrics/lyric-language'
import { getMotionFeatures } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'
import { isAdmin as checkIsAdmin } from '@/utils/common/permission'

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

export interface TranslationLanguageMenuProps {
  compact?: boolean
  setShowTranslation?: (val: boolean) => void
  translationLang?: LyricTargetLang | null
  preferNativeTranslation?: boolean
  translationSelections?: LyricTranslationSelection[]
  availableTranslationLangs?: MusicLyricTranslationLangStatus[]
  setTranslationLang?: (lang: LyricTargetLang | null, preferNative?: boolean) => void
  setTranslationSelections?: (selections: LyricTranslationSelection[]) => void
  isAdmin?: boolean
  musicAiEnabled?: boolean
  currentTrack: ReturnType<typeof useMusicPlayback>['currentTrack']
  lyrics: ReturnType<typeof useMusicLyrics>['lyrics']
}

interface MoreControlsMenuProps {
  showLyricMoments: boolean
  setShowLyricMoments: (val: boolean) => void
  showLyricEffects: boolean
  setShowLyricEffects: (val: boolean) => void
  showRomaji: boolean
  showTranslation: boolean
  hdr: boolean
  setHdr: (val: boolean) => void
  hdrDisplay: boolean
  currentTrack: ReturnType<typeof useMusicPlayback>['currentTrack']
  lyrics: ReturnType<typeof useMusicLyrics>['lyrics']
}

const TRANSLATION_LANG_INTL_CODES: Record<string, string> = {
  'zh': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-HK',
}

function formatTranslationLangLabel(lang: string, locale: string): string {
  try {
    const code = TRANSLATION_LANG_INTL_CODES[lang] ?? lang
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? lang
  }
  catch {
    return lang
  }
}

function formatBackgroundLyricText(text: string): string {
  if (
    (text.startsWith('(') && text.endsWith(')'))
    || (text.startsWith('（') && text.endsWith('）'))
  ) {
    return text
  }
  return `(${text})`
}

function buildFormattedLyricsClipboardText({
  currentTrack,
  lyrics,
  showRomaji,
  showTranslation,
}: {
  currentTrack: ReturnType<typeof useMusicPlayback>['currentTrack']
  lyrics: ReturnType<typeof useMusicLyrics>['lyrics']
  showRomaji: boolean
  showTranslation: boolean
}): string | null {
  const lines = lyrics?.lines
  if (!lines || lines.length === 0)
    return null

  const title = currentTrack?.name ?? ''
  const artists = currentTrack?.artists
    ? (Array.isArray(currentTrack.artists) ? currentTrack.artists.join(' / ') : currentTrack.artists)
    : ''
  const header = title ? `${title}${artists ? ` - ${artists}` : ''}\n\n` : ''

  const groups = lines.map((line) => {
    const rawOrig = getLyricLineText(line).trim()
    if (!rawOrig)
      return null
    const orig = line.isBackground ? formatBackgroundLyricText(rawOrig) : rawOrig
    const parts = [orig]
    if (showRomaji && line.romanization?.trim())
      parts.push(line.romanization.trim())
    if (showTranslation) {
      if (line.translation?.trim())
        parts.push(line.translation.trim())
      if (line.secondaryTranslation?.trim())
        parts.push(line.secondaryTranslation.trim())
    }
    return parts
  }).filter((parts): parts is string[] => parts !== null)

  const hasExtra = groups.some(parts => parts.length > 1)
  const content = groups.map(parts => parts.join('\n')).join(hasExtra ? '\n\n' : '\n')
  if (!content)
    return null

  const fullText = (header + content).trim()
  return fullText || null
}

function TranslationSelectionIndicator({ index, total }: { index: number, total: number }) {
  if (index >= 0 && total > 1) {
    return (
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] leading-none font-bold text-neutral-950">
        {index + 1}
      </span>
    )
  }
  return (
    <CheckIcon
      aria-hidden
      className={cn('size-3.5 shrink-0', index >= 0 ? 'opacity-100' : 'opacity-0')}
    />
  )
}

/**
 * 翻译语言选择菜单（置于翻译开关左侧，与站点 UI 语言解耦；
 * 支持同语种 AI / 内置切换与最多 2 项按勾选顺序对比，管理员额外可触发新语种或 AI 覆盖）。
 */
export function TranslationLanguageMenu({
  compact = false,
  setShowTranslation,
  translationLang,
  preferNativeTranslation = false,
  translationSelections,
  availableTranslationLangs,
  setTranslationLang,
  setTranslationSelections,
  isAdmin,
  musicAiEnabled,
  currentTrack,
  lyrics,
}: TranslationLanguageMenuProps) {
  const playerT = useTranslations('MusicPlayer')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [triggeringLang, setTriggeringLang] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleClose = useCallback((delayMs = 8000) => {
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
      scheduleClose(8000)
    else
      cancelClose()
    return () => cancelClose()
  }, [open, scheduleClose, cancelClose])

  useEffect(() => {
    if (!open)
      return
    const onPointerDownOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDownOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const lyricSource = lyrics?.source && lyrics.source !== 'none' ? lyrics.source : null
  const adminActionable = Boolean(isAdmin && musicAiEnabled && currentTrack?.id && lyricSource)
  const allStatuses = useMemo(
    () => availableTranslationLangs ?? [],
    [availableTranslationLangs],
  )
  const availableItems = useMemo(
    () => allStatuses.filter(item => item.hasAi || item.hasNative || item.generating),
    [allStatuses],
  )
  const untranslatedAdminItems = useMemo(() => {
    if (!adminActionable)
      return []
    return allStatuses.filter(item =>
      !(item.hasAi || item.hasNative || item.generating)
      && !item.sameLanguage
      && canAdminAiTranslateLyrics(lyrics, item.lang as LyricTargetLang, currentTrack?.artists),
    )
  }, [adminActionable, allStatuses, currentTrack?.artists, lyrics])
  const activeSelections = useMemo<LyricTranslationSelection[]>(() => {
    if (translationSelections !== undefined)
      return translationSelections
    return translationLang ? [{ lang: translationLang, preferNative: Boolean(preferNativeTranslation) }] : []
  }, [preferNativeTranslation, translationLang, translationSelections])

  const applySelections = useCallback((next: LyricTranslationSelection[]) => {
    if (setTranslationSelections) {
      setTranslationSelections(next)
      return
    }
    setTranslationLang?.(next[0]?.lang ?? null, Boolean(next[0]?.preferNative))
  }, [setTranslationLang, setTranslationSelections])

  const canOpenMenu = Boolean(setTranslationSelections || setTranslationLang)
    && (availableItems.length > 0 || (adminActionable && untranslatedAdminItems.length > 0))
  const isMenuVisible = open && canOpenMenu

  const handleToggleOption = useCallback((target: LyricTranslationSelection, hasDualSources: boolean) => {
    const next = toggleLyricTranslationSelection(activeSelections, target, { hasDualSources })
    applySelections(next)
    setShowTranslation?.(true)
    scheduleClose(8000)
  }, [activeSelections, applySelections, scheduleClose, setShowTranslation])

  const handleTriggerTranslation = useCallback(async (lang: LyricTargetLang) => {
    if (!adminActionable || !currentTrack?.id || !lyricSource || triggeringLang)
      return
    setTriggeringLang(lang)
    const hasSameLangAiSelected = activeSelections.some(item => item.lang === lang && !item.preferNative)
    if (!hasSameLangAiSelected) {
      const hasSameLangNativeOnly = activeSelections.some(item => item.lang === lang && Boolean(item.preferNative))
      if (hasSameLangNativeOnly) {
        applySelections(activeSelections.map(item =>
          item.lang === lang ? { lang, preferNative: false } : item,
        ))
      }
      else {
        applySelections([{ lang, preferNative: false }])
      }
    }
    setShowTranslation?.(true)
    try {
      const res = await refreshTranslations(currentTrack.id, lyricSource, lang)
      if (res === 'started') {
        toast.success(playerT('translation_generate_started', { lang: formatTranslationLangLabel(lang, locale) }))
        requestLyricTranslationLanguages(currentTrack.id, lyricSource, true)
      }
      else {
        toast.error(playerT('translation_generate_failed'))
      }
    }
    catch {
      toast.error(playerT('translation_generate_failed'))
    }
    finally {
      setTriggeringLang(null)
    }
  }, [activeSelections, adminActionable, applySelections, currentTrack?.id, locale, lyricSource, playerT, setShowTranslation, triggeringLang])

  return (
    // 控制栏在播放器页和悬浮球里处于顶栏 <LazyMotion> 外部，需要自备特征包驱动 <m.div>
    <LazyMotion features={getMotionFeatures()} strict>
      <div
        ref={containerRef}
        className="relative flex items-center"
        onMouseEnter={cancelClose}
        onMouseLeave={() => open && scheduleClose(4500)}
      >
        <AnimatePresence>
          {isMenuVisible && (
            <m.div
              role="menu"
              aria-label={playerT('translation_language')}
              initial={{ opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 6 }}
              transition={{
                type: 'spring',
                stiffness: 420,
                damping: 28,
                mass: 0.75,
              }}
              className={cn(
                'absolute bottom-full z-40 mb-2 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950/90 p-1.5 text-white shadow-2xl backdrop-blur-2xl',
                compact
                  ? '-right-28 origin-bottom-right'
                  : '-right-28 origin-bottom-right sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:origin-bottom',
              )}
            >
              <div className="px-2.5 py-1 text-[11px] font-medium text-white/50">
                {playerT('translation_compare_hint')}
              </div>
              <button
                type="button"
                onClick={() => {
                  applySelections([])
                  setShowTranslation?.(true)
                  scheduleClose(4500)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition hover:bg-white/10',
                  activeSelections.length === 0 ? 'bg-white/10 font-medium text-white' : 'text-white/80',
                )}
              >
                <CheckIcon
                  aria-hidden
                  className={cn('size-3.5 shrink-0', activeSelections.length === 0 ? 'opacity-100' : 'opacity-0')}
                />
                <span className="min-w-0 flex-1 truncate">{playerT('translation_lang_follow_site')}</span>
              </button>

              {availableItems.flatMap((item) => {
                const langCode = item.lang as LyricTargetLang
                const hasDualSources = (item.hasAi || item.generating) && item.hasNative
                const canRegenerate = adminActionable && item.hasAi && !item.generating

                if (hasDualSources) {
                  const aiIndex = activeSelections.findIndex(entry => entry.lang === langCode && !entry.preferNative)
                  const nativeIndex = activeSelections.findIndex(entry => entry.lang === langCode && Boolean(entry.preferNative))
                  return [
                    (
                      <div
                        key={item.lang}
                        className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10"
                      >
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={aiIndex >= 0}
                          onClick={() => handleToggleOption({ lang: langCode, preferNative: false }, true)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                            aiIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                          )}
                        >
                          <TranslationSelectionIndicator index={aiIndex} total={activeSelections.length} />
                          <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                          {item.generating
                            ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin text-white/80" />
                            : (
                                <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                                  {playerT('translation_badge_ai')}
                                </span>
                              )}
                        </button>
                        {canRegenerate && (
                          <button
                            type="button"
                            aria-label={playerT('translation_regenerate')}
                            title={playerT('translation_regenerate')}
                            disabled={triggeringLang != null}
                            onClick={() => void handleTriggerTranslation(langCode)}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                          >
                            <RotateCwIcon aria-hidden className="size-3" />
                          </button>
                        )}
                      </div>
                    ),
                    (
                      <div
                        key={`${item.lang}-native`}
                        className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10"
                      >
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={nativeIndex >= 0}
                          onClick={() => handleToggleOption({ lang: langCode, preferNative: true }, true)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                            nativeIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                          )}
                        >
                          <TranslationSelectionIndicator index={nativeIndex} total={activeSelections.length} />
                          <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                            {playerT('translation_badge_native')}
                          </span>
                        </button>
                      </div>
                    ),
                  ]
                }

                const selectedIndex = activeSelections.findIndex(entry => entry.lang === langCode)
                const canOverride = adminActionable
                  && !item.hasAi
                  && item.hasNative
                  && !item.generating
                  && canAdminAiTranslateLyrics(lyrics, langCode, currentTrack?.artists)
                return [
                  (
                    <div
                      key={item.lang}
                      className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10"
                    >
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={selectedIndex >= 0}
                        onClick={() => handleToggleOption({ lang: langCode, preferNative: false }, false)}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                          selectedIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                        )}
                      >
                        <TranslationSelectionIndicator index={selectedIndex} total={activeSelections.length} />
                        <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                        {item.generating
                          ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin text-white/80" />
                          : item.hasAi
                            ? (
                                <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                                  {playerT('translation_badge_ai')}
                                </span>
                              )
                            : (
                                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">
                                  {playerT('translation_badge_native')}
                                </span>
                              )}
                      </button>
                      {canOverride && (
                        <button
                          type="button"
                          disabled={triggeringLang != null}
                          onClick={() => void handleTriggerTranslation(langCode)}
                          className="shrink-0 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white transition hover:bg-white/25 disabled:opacity-50"
                        >
                          {playerT('translation_ai_override')}
                        </button>
                      )}
                      {canRegenerate && (
                        <button
                          type="button"
                          aria-label={playerT('translation_regenerate')}
                          title={playerT('translation_regenerate')}
                          disabled={triggeringLang != null}
                          onClick={() => void handleTriggerTranslation(langCode)}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                        >
                          <RotateCwIcon aria-hidden className="size-3" />
                        </button>
                      )}
                    </div>
                  ),
                ]
              })}

              {adminActionable && untranslatedAdminItems.length > 0 && (
                <>
                  <div className="my-1 border-t border-white/10" />
                  <div className="px-2.5 py-1 text-[11px] font-medium text-white/50">
                    {playerT('translation_untranslated_group')}
                  </div>
                  {untranslatedAdminItems.map((item) => {
                    const langCode = item.lang as LyricTargetLang
                    return (
                      <button
                        key={item.lang}
                        type="button"
                        disabled={triggeringLang != null}
                        onClick={() => void handleTriggerTranslation(langCode)}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        <span className="size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                        {triggeringLang === item.lang
                          ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin" />
                          : <SparklesIcon aria-hidden className="size-3 shrink-0 text-white/60" />}
                      </button>
                    )
                  })}
                </>
              )}
            </m.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          aria-label={playerT('translation_language')}
          title={canOpenMenu ? playerT('translation_language') : playerT('no_extra_lyric')}
          aria-haspopup="menu"
          aria-expanded={isMenuVisible}
          disabled={!canOpenMenu}
          onClick={() => {
            const next = !open
            setOpen(next)
            if (next && currentTrack?.id && lyricSource)
              requestLyricTranslationLanguages(currentTrack.id, lyricSource, true)
          }}
          className={cn(
            MUSIC_ICON_BUTTON_CLASSNAME,
            activeSelections.length > 0 && 'text-white',
            isMenuVisible && 'bg-white/15 text-white',
          )}
        >
          <GlobeIcon aria-hidden className="size-5" />
        </button>
      </div>
    </LazyMotion>
  )
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
  showRomaji,
  showTranslation,
  hdr,
  setHdr,
  hdrDisplay,
  currentTrack,
  lyrics,
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
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDownOutside)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownOutside)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleCopyLyrics = useCallback(async () => {
    const fullText = buildFormattedLyricsClipboardText({
      currentTrack,
      lyrics,
      showRomaji,
      showTranslation,
    })
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
  }, [currentTrack, lyrics, playerT, scheduleClose, showRomaji, showTranslation])

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
              {/* 复制整首歌词（含背景和声，按读音/翻译开关动态排版） */}
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
 * 悬浮小窗（MiniPlayer）顶栏右上角统一控制中心：
 * 将原本小窗第 3 排的音量/静音、翻译、音译、歌词特效、评论旁白、HDR、复制歌词及翻译语言选择收纳为紧凑卡片，
 * 为小窗省出整排底部高度并补贴给歌词舞台（与 macOS 灵动岛 ExpandedControlCenterPopover 1:1 对齐）。
 */
export function MiniPlayerMoreMenu() {
  const t = useTranslations('MusicPage')
  const playerT = useTranslations('MusicPlayer')
  const locale = useLocale()
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const admin = user ? checkIsAdmin({ user }) : false
  const { currentTrack } = useMusicPlayback()
  const { volume, isMuted, setVolume, toggleMuted } = useMusicVolume()
  const {
    canToggleTranslation,
    lyricTranslationsGenerating,
    availableTranslationLangs,
    canToggleRomaji,
    lyricPronunciationsGenerating,
    lyrics,
  } = useMusicLyrics()
  const {
    showTranslation,
    translationLang,
    preferNativeTranslation,
    translationSelections,
    showRomaji,
    setShowTranslation,
    setTranslationLang,
    setTranslationSelections,
    setShowRomaji,
    showLyricEffects,
    setShowLyricEffects,
    showLyricMoments,
    setShowLyricMoments,
    hdr,
    setHdr,
  } = useMusicPreferences()
  const hdrDisplay = useHdrDisplay()

  const [open, setOpen] = useState(false)
  const [panelPage, setPanelPage] = useState<'main' | 'languages'>('main')
  const [copied, setCopied] = useState(false)
  const [triggeringLang, setTriggeringLang] = useState<string | null>(null)

  const muted = isMuted || volume === 0
  const volumePercent = Math.round((muted ? 0 : volume) * 100)
  const VolumeIcon = muted ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon

  const lyricSource = lyrics?.source && lyrics.source !== 'none' ? lyrics.source : null
  const adminActionable = Boolean(admin && siteInfo.musicAiEnabled && currentTrack?.id && lyricSource)
  const allStatuses = useMemo(() => availableTranslationLangs ?? [], [availableTranslationLangs])
  const availableItems = useMemo(
    () => allStatuses.filter(item => item.hasAi || item.hasNative || item.generating),
    [allStatuses],
  )
  const untranslatedAdminItems = useMemo(() => {
    if (!adminActionable)
      return []
    return allStatuses.filter(item =>
      !(item.hasAi || item.hasNative || item.generating)
      && !item.sameLanguage
      && canAdminAiTranslateLyrics(lyrics, item.lang as LyricTargetLang, currentTrack?.artists),
    )
  }, [adminActionable, allStatuses, currentTrack?.artists, lyrics])

  const activeSelections = useMemo<LyricTranslationSelection[]>(() => {
    if (translationSelections !== undefined)
      return translationSelections
    return translationLang ? [{ lang: translationLang, preferNative: Boolean(preferNativeTranslation) }] : []
  }, [preferNativeTranslation, translationLang, translationSelections])

  const applySelections = useCallback((next: LyricTranslationSelection[]) => {
    if (setTranslationSelections) {
      setTranslationSelections(next)
      return
    }
    setTranslationLang?.(next[0]?.lang ?? null, Boolean(next[0]?.preferNative))
  }, [setTranslationLang, setTranslationSelections])

  const canOpenLangList = availableItems.length > 0 || (adminActionable && untranslatedAdminItems.length > 0)

  const currentLangSummary = useMemo(() => {
    if (activeSelections.length === 0)
      return playerT('translation_lang_follow_site')
    return activeSelections.map(s => formatTranslationLangLabel(s.lang, locale)).join(' + ')
  }, [activeSelections, locale, playerT])

  const handleToggleOption = useCallback((target: LyricTranslationSelection, hasDualSources: boolean) => {
    const next = toggleLyricTranslationSelection(activeSelections, target, { hasDualSources })
    applySelections(next)
    setShowTranslation(true)
  }, [activeSelections, applySelections, setShowTranslation])

  const handleTriggerTranslation = useCallback(async (lang: LyricTargetLang) => {
    if (!adminActionable || !currentTrack?.id || !lyricSource || triggeringLang)
      return
    setTriggeringLang(lang)
    const hasSameLangAiSelected = activeSelections.some(item => item.lang === lang && !item.preferNative)
    if (!hasSameLangAiSelected) {
      const hasSameLangNativeOnly = activeSelections.some(item => item.lang === lang && Boolean(item.preferNative))
      if (hasSameLangNativeOnly) {
        applySelections(activeSelections.map(item =>
          item.lang === lang ? { lang, preferNative: false } : item,
        ))
      }
      else {
        applySelections([{ lang, preferNative: false }])
      }
    }
    setShowTranslation(true)
    try {
      const res = await refreshTranslations(currentTrack.id, lyricSource, lang)
      if (res === 'started') {
        toast.success(playerT('translation_generate_started', { lang: formatTranslationLangLabel(lang, locale) }))
        requestLyricTranslationLanguages(currentTrack.id, lyricSource, true)
      }
      else {
        toast.error(playerT('translation_generate_failed'))
      }
    }
    catch {
      toast.error(playerT('translation_generate_failed'))
    }
    finally {
      setTriggeringLang(null)
    }
  }, [activeSelections, adminActionable, applySelections, currentTrack?.id, locale, lyricSource, playerT, setShowTranslation, triggeringLang])

  const handleCopy = useCallback(async () => {
    const fullText = buildFormattedLyricsClipboardText({
      currentTrack,
      lyrics,
      showRomaji,
      showTranslation,
    })
    if (!fullText) {
      toast.error(playerT('no_lyrics_to_copy'))
      return
    }
    try {
      await navigator.clipboard.writeText(fullText)
      setCopied(true)
      toast.success(playerT('lyrics_copied'))
      setTimeout(setCopied, 2000, false)
    }
    catch {
      toast.error(playerT('no_lyrics_to_copy'))
    }
  }, [currentTrack, lyrics, playerT, showRomaji, showTranslation])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next)
          setPanelPage('main')
        else if (currentTrack?.id && lyricSource)
          requestLyricTranslationLanguages(currentTrack.id, lyricSource, true)
      }}
    >
      <PopoverTrigger
        aria-label={playerT('more_options')}
        title={playerT('more_options')}
        className={cn(
          MUSIC_ICON_BUTTON_CLASSNAME,
          'relative -mt-1 self-start',
          open && 'bg-white/15 text-white',
        )}
      >
        <MoreHorizontalIcon aria-hidden className={cn('size-4 transition-transform duration-200', open && 'rotate-90')} />
        {muted && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-amber-400 ring-1 ring-neutral-950"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={10}
        style={PLAYER_STYLE}
        className="dark z-1001 w-62 max-w-[calc(100vw-1rem)] rounded-2xl border-white/12 bg-neutral-900/95 p-2.5 text-white shadow-2xl backdrop-blur-2xl"
      >
        {panelPage === 'main'
          ? (
              <div className="grid gap-2.5">
                {/* 1. 音量滑块 + 一键静音 */}
                <div className="flex items-center gap-2 px-0.5">
                  <button
                    type="button"
                    aria-label={playerT(isMuted ? 'unmute' : 'mute')}
                    title={playerT(isMuted ? 'unmute' : 'mute')}
                    onClick={toggleMuted}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <VolumeIcon aria-hidden className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <ProgressControl
                      value={volumePercent}
                      step={5}
                      ariaLabel={t('volume')}
                      ariaValueText={`${volumePercent}%`}
                      onChange={(next) => {
                        setVolume(next / 100)
                        if (isMuted && next > 0)
                          toggleMuted()
                      }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] font-medium text-white/60 tabular-nums">
                    {`${volumePercent}%`}
                  </span>
                </div>

                <div className="border-t border-white/10" />

                {/* 2. 3×2 短标签胶囊开关网格 */}
                <div className="grid grid-cols-3 gap-1.5">
                  <MiniTileButton
                    icon={LanguagesIcon}
                    label={t('lyric_badge_translation')}
                    title={lyricTranslationsGenerating ? playerT('translating_lyric') : canToggleTranslation ? playerT('show_translation') : playerT('no_extra_lyric')}
                    active={canToggleTranslation && showTranslation}
                    disabled={!canToggleTranslation}
                    busy={lyricTranslationsGenerating}
                    onClick={() => setShowTranslation(!showTranslation)}
                  />
                  <MiniTileButton
                    icon={CaseSensitiveIcon}
                    label={t('lyric_badge_romanization')}
                    title={lyricPronunciationsGenerating ? playerT('generating_romaji') : canToggleRomaji ? playerT('show_romaji') : playerT('no_extra_lyric')}
                    active={canToggleRomaji && showRomaji}
                    disabled={!canToggleRomaji}
                    busy={lyricPronunciationsGenerating}
                    onClick={() => setShowRomaji(!showRomaji)}
                  />
                  <MiniTileButton
                    icon={SparklesIcon}
                    label={playerT('show_lyric_effects')}
                    active={showLyricEffects}
                    onClick={() => setShowLyricEffects(!showLyricEffects)}
                  />
                  <MiniTileButton
                    icon={MessageSquareQuoteIcon}
                    label={playerT('show_lyric_moments')}
                    active={showLyricMoments}
                    onClick={() => setShowLyricMoments(!showLyricMoments)}
                  />
                  <MiniTileButton
                    icon={TbHdr}
                    label="HDR"
                    title={hdrDisplay ? playerT('hdr_highlight') : playerT('hdr_unsupported')}
                    active={hdrDisplay && hdr}
                    disabled={!hdrDisplay}
                    onClick={() => setHdr(!hdr)}
                  />
                  <MiniTileButton
                    icon={copied ? CheckIcon : CopyIcon}
                    label={playerT('copy_lyrics')}
                    title={copied ? playerT('lyrics_copied') : playerT('copy_lyrics')}
                    active={copied}
                    highlightEmerald={copied}
                    onClick={() => void handleCopy()}
                  />
                </div>

                {/* 3. 翻译语言折叠展开入口 */}
                {canOpenLangList && (
                  <>
                    <div className="border-t border-white/10" />
                    <button
                      type="button"
                      onClick={() => setPanelPage('languages')}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/10"
                    >
                      <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-white/70" />
                      <span className="shrink-0 text-xs font-medium text-white/85">
                        {playerT('translation_language')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right text-[11px] text-white/50">
                        {currentLangSummary}
                      </span>
                      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-white/45" />
                    </button>
                  </>
                )}
              </div>
            )
          : (
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2 px-1 pb-1">
                  <button
                    type="button"
                    onClick={() => setPanelPage('main')}
                    className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeftIcon aria-hidden className="size-3.5" />
                    <span>{t('back')}</span>
                  </button>
                  <span className="truncate text-[10px] text-white/45">
                    {playerT('translation_compare_hint')}
                  </span>
                </div>

                <div className="max-h-56 overflow-y-auto overscroll-contain">
                  <button
                    type="button"
                    onClick={() => {
                      applySelections([])
                      setShowTranslation(true)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition hover:bg-white/10',
                      activeSelections.length === 0 ? 'bg-white/10 font-medium text-white' : 'text-white/80',
                    )}
                  >
                    <CheckIcon
                      aria-hidden
                      className={cn('size-3.5 shrink-0', activeSelections.length === 0 ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="min-w-0 flex-1 truncate">{playerT('translation_lang_follow_site')}</span>
                  </button>

                  {availableItems.flatMap((item) => {
                    const langCode = item.lang as LyricTargetLang
                    const hasDualSources = (item.hasAi || item.generating) && item.hasNative
                    const canRegenerate = adminActionable && item.hasAi && !item.generating

                    if (hasDualSources) {
                      const aiIndex = activeSelections.findIndex(entry => entry.lang === langCode && !entry.preferNative)
                      const nativeIndex = activeSelections.findIndex(entry => entry.lang === langCode && Boolean(entry.preferNative))
                      return [
                        (
                          <div key={item.lang} className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10">
                            <button
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={aiIndex >= 0}
                              onClick={() => handleToggleOption({ lang: langCode, preferNative: false }, true)}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                                aiIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                              )}
                            >
                              <TranslationSelectionIndicator index={aiIndex} total={activeSelections.length} />
                              <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                              {item.generating
                                ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin text-white/80" />
                                : <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">{playerT('translation_badge_ai')}</span>}
                            </button>
                            {canRegenerate && (
                              <button
                                type="button"
                                aria-label={playerT('translation_regenerate')}
                                title={playerT('translation_regenerate')}
                                disabled={triggeringLang != null}
                                onClick={() => void handleTriggerTranslation(langCode)}
                                className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                              >
                                <RotateCwIcon aria-hidden className="size-3" />
                              </button>
                            )}
                          </div>
                        ),
                        (
                          <div key={`${item.lang}-native`} className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10">
                            <button
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={nativeIndex >= 0}
                              onClick={() => handleToggleOption({ lang: langCode, preferNative: true }, true)}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                                nativeIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                              )}
                            >
                              <TranslationSelectionIndicator index={nativeIndex} total={activeSelections.length} />
                              <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{playerT('translation_badge_native')}</span>
                            </button>
                          </div>
                        ),
                      ]
                    }

                    const selectedIndex = activeSelections.findIndex(entry => entry.lang === langCode)
                    const canOverride = adminActionable
                      && !item.hasAi
                      && item.hasNative
                      && !item.generating
                      && canAdminAiTranslateLyrics(lyrics, langCode, currentTrack?.artists)
                    return [
                      (
                        <div key={item.lang} className="flex items-center gap-1 rounded-xl px-1 py-0.5 transition hover:bg-white/10">
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={selectedIndex >= 0}
                            onClick={() => handleToggleOption({ lang: langCode, preferNative: false }, false)}
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs',
                              selectedIndex >= 0 ? 'font-medium text-white' : 'text-white/85',
                            )}
                          >
                            <TranslationSelectionIndicator index={selectedIndex} total={activeSelections.length} />
                            <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                            {item.generating
                              ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin text-white/80" />
                              : item.hasAi
                                ? <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">{playerT('translation_badge_ai')}</span>
                                : <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{playerT('translation_badge_native')}</span>}
                          </button>
                          {canOverride && (
                            <button
                              type="button"
                              disabled={triggeringLang != null}
                              onClick={() => void handleTriggerTranslation(langCode)}
                              className="shrink-0 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white transition hover:bg-white/25 disabled:opacity-50"
                            >
                              {playerT('translation_ai_override')}
                            </button>
                          )}
                          {canRegenerate && (
                            <button
                              type="button"
                              aria-label={playerT('translation_regenerate')}
                              title={playerT('translation_regenerate')}
                              disabled={triggeringLang != null}
                              onClick={() => void handleTriggerTranslation(langCode)}
                              className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                            >
                              <RotateCwIcon aria-hidden className="size-3" />
                            </button>
                          )}
                        </div>
                      ),
                    ]
                  })}

                  {adminActionable && untranslatedAdminItems.length > 0 && (
                    <>
                      <div className="my-1 border-t border-white/10" />
                      <div className="px-2.5 py-1 text-[11px] font-medium text-white/50">
                        {playerT('translation_untranslated_group')}
                      </div>
                      {untranslatedAdminItems.map((item) => {
                        const langCode = item.lang as LyricTargetLang
                        return (
                          <button
                            key={item.lang}
                            type="button"
                            disabled={triggeringLang != null}
                            onClick={() => void handleTriggerTranslation(langCode)}
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                          >
                            <span className="size-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{formatTranslationLangLabel(item.lang, locale)}</span>
                            {triggeringLang === item.lang
                              ? <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin" />
                              : <SparklesIcon aria-hidden className="size-3 shrink-0 text-white/60" />}
                          </button>
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
      </PopoverContent>
    </Popover>
  )
}

function MiniTileButton({
  icon: Icon,
  label,
  title,
  active,
  disabled,
  busy,
  highlightEmerald,
  onClick,
}: {
  icon: LucideIcon | IconType
  label: string
  title?: string
  active?: boolean
  disabled?: boolean
  busy?: boolean
  highlightEmerald?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={title ?? label}
      title={title ?? label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center transition-[color,background-color,border-color,transform] active:scale-95 disabled:pointer-events-none disabled:opacity-30',
        active
          ? 'border-white/20 bg-white/16 text-white'
          : 'border-transparent bg-white/6 text-white/60 hover:bg-white/11 hover:text-white/90',
      )}
    >
      {busy
        ? <Loader2Icon aria-hidden className="size-4 animate-spin" />
        : <Icon aria-hidden className={cn('size-4 shrink-0', highlightEmerald && 'text-emerald-400')} />}
      <span className="w-full truncate text-[11px] leading-tight font-medium">
        {label}
      </span>
    </button>
  )
}

/**
 * 播放器页控制栏：进度、上一首 / 播放 / 下一首、播放模式、音量、翻译与音译开关、歌单。
 * compact 为悬浮播放器使用的紧凑模式：仅保留进度条与经典对称五键，次级偏好统一收纳到顶栏右上角 MiniPlayerMoreMenu
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
  const { user } = useAuth()
  const { siteInfo } = useSiteInfo()
  const admin = user ? checkIsAdmin({ user }) : false
  const { isPlaying, pendingStep, playMode, currentTrack } = useMusicPlayback()
  const {
    canToggleTranslation,
    lyricTranslationsGenerating,
    availableTranslationLangs,
    canToggleRomaji,
    lyricPronunciationsGenerating,
    lyrics,
  } = useMusicLyrics()
  const {
    showTranslation,
    translationLang,
    preferNativeTranslation,
    translationSelections,
    showRomaji,
    setShowTranslation,
    setTranslationLang,
    setTranslationSelections,
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
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <VolumeControl compact={compact} />
          {/* 次要按钮：保留高频的翻译语言、翻译与读音，其余收纳为三点菜单 */}
          <div className="flex items-center gap-1 pointer-coarse:gap-1.5">
            <TranslationLanguageMenu
              compact={compact}
              setShowTranslation={setShowTranslation}
              translationLang={translationLang}
              preferNativeTranslation={preferNativeTranslation}
              translationSelections={translationSelections}
              availableTranslationLangs={availableTranslationLangs}
              setTranslationLang={setTranslationLang}
              setTranslationSelections={setTranslationSelections}
              isAdmin={admin}
              musicAiEnabled={Boolean(siteInfo.musicAiEnabled)}
              currentTrack={currentTrack}
              lyrics={lyrics}
            />
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
              showRomaji={showRomaji}
              showTranslation={showTranslation}
              hdr={hdr}
              setHdr={setHdr}
              hdrDisplay={hdrDisplay}
              currentTrack={currentTrack}
              lyrics={lyrics}
            />
          </div>
        </div>
      )}
    </div>
  )
}
