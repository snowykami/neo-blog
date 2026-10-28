'use client'

import type { LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricSource, ResolvedLyrics } from '@/lib/lyrics/types'
import { ChevronDownIcon, LoaderCircleIcon, PinIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { LyricSourceIcon } from './lyric-source-icons'

const SOURCE_KEYS: Record<Exclude<LyricSource, 'none'>, string> = {
  'ncm-yrc': 'lyric_source_ncm',
  'ncm-lrc': 'lyric_source_ncm',
  'qq-qrc': 'lyric_source_qq',
  'qq-lrc': 'lyric_source_qq',
  'ttml-amll': 'lyric_source_amll',
  'ttml-custom': 'lyric_source_custom',
}

/** 歌词来源的名称（MusicPage 下的文案键），没有歌词时为 null */
export function lyricSourceLabelKey(source: LyricSource): string | null {
  return source === 'none' ? null : SOURCE_KEYS[source]
}

const AUTO = 'auto'

/**
 * 歌词来源标签：来源的标志 + 「来源 · 逐字 / 逐行 · 翻译 · 音译」（功能与 StarryPlayer 播放页的歌词标签一致，外观为我们自己的单色标志样式）。
 * 有多个来源时点击可切换：选择某个来源即为这首歌固定该来源（下次播放仍使用），选择「自动」按等级选择；
 * 更高等级的来源仍在请求中时显示加载图标；叠加了 AI 歌词标注时在最前面显示 AI 标志
 */
export function LyricSourceBadge({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { lyrics, lyricStatus, lyricCandidates, lyricKind, lyricPin, setLyricPin, lyricSourcesPending, lyricAnnotated } = useMusic()
  if (lyricStatus === 'loading')
    return null

  const describe = (target: ResolvedLyrics) => {
    if (target.source === 'none' || target.lines.length === 0)
      return t(target.instrumental ? 'lyric_badge_instrumental' : 'lyric_badge_none')
    return [
      t(SOURCE_KEYS[target.source]),
      t(target.wordTimed ? 'lyric_badge_word' : 'lyric_badge_line'),
      target.lines.some(line => line.translation) && t('lyric_badge_translation'),
      target.lines.some(line => line.romanization) && t('lyric_badge_romanization'),
    ].filter(Boolean).join(' · ')
  }

  const switchable = lyricCandidates.length > 1 || lyricPin != null
  const badge = (
    <span
      className={cn(
        'inline-flex h-[1.125rem] items-center gap-1 rounded-full bg-white/10 px-1.5 text-[10px] leading-none font-medium text-white/70',
        switchable && 'transition-colors hover:bg-white/15 hover:text-white/90',
      )}
    >
      {lyricAnnotated && (
        <span title={t('lyric_badge_ai_effects')} className="inline-flex shrink-0">
          <SparklesIcon aria-hidden className="size-3" />
          <span className="sr-only">{t('lyric_badge_ai_effects')}</span>
        </span>
      )}
      {/* 来源标志：网易云、QQ 音乐、AMLL 等各自的标志，统一为与文字相同的单色 */}
      <LyricSourceIcon source={lyrics.lines.length > 0 ? lyrics.source : 'none'} className="size-3 shrink-0" />
      <span className="sr-only">{t('lyric_badge_label')}</span>
      {describe(lyrics)}
      {lyricPin && <PinIcon aria-label={t('lyric_badge_pinned')} className="size-2.5 shrink-0" />}
      {lyricSourcesPending && <LoaderCircleIcon aria-label={t('lyric_badge_upgrading')} className="size-2.5 shrink-0 motion-safe:animate-spin" />}
      {switchable && <ChevronDownIcon aria-hidden className="-mr-0.5 size-2.5 shrink-0" />}
    </span>
  )
  if (!switchable)
    return <span title={t('lyric_badge_label')} className={cn('inline-flex', className)}>{badge}</span>

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title={t('lyric_badge_switch')}
        // className 加在外层：页面用它控制标签在网格中的位置（移动端居中）
        className={cn('inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none', className)}
      >
        {badge}
      </DropdownMenuTrigger>
      {/* 播放器页固定为深色界面；下拉菜单渲染在 body 下，单独加 dark。层级高于悬浮播放器的弹层（z-1000） */}
      <DropdownMenuContent align="start" className="dark z-1001 min-w-56 border-white/10 bg-neutral-900/95 text-white backdrop-blur-xl">
        <DropdownMenuLabel className="text-xs text-white/60">{t('lyric_badge_switch')}</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuRadioGroup
          value={lyricPin ?? AUTO}
          onValueChange={value => setLyricPin(value === AUTO ? null : value as LyricSourceKind)}
        >
          <DropdownMenuRadioItem value={AUTO} className="text-xs">
            <span className="grid">
              {t('lyric_badge_auto')}
              {lyricKind && !lyricPin && <span className="text-[11px] text-white/50">{describe(lyrics)}</span>}
            </span>
          </DropdownMenuRadioItem>
          {lyricCandidates.map(candidate => (
            <DropdownMenuRadioItem key={candidate.kind} value={candidate.kind} className="gap-2 text-xs">
              <LyricSourceIcon source={candidate.lyrics.source} className="size-3.5 shrink-0 text-white/80" />
              {describe(candidate.lyrics)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
