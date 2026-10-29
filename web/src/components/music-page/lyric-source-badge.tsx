'use client'

import type { LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricSource, ResolvedLyrics } from '@/lib/lyrics/types'
import { ChevronDownIcon, LoaderCircleIcon, PinIcon, RotateCwIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { setLyricSitePin, useLyricSitePin } from '@/contexts/lyric-settings'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/utils/common/permission'
import { LyricSourceIcon } from './lyric-source-icons'

const SOURCE_KEYS: Record<Exclude<LyricSource, 'none'>, string> = {
  'ncm-yrc': 'lyric_source_ncm',
  'ncm-lrc': 'lyric_source_ncm',
  'qq-qrc': 'lyric_source_qq',
  'qq-lrc': 'lyric_source_qq',
  'kugou-krc': 'lyric_source_kugou',
  'kugou-lrc': 'lyric_source_kugou',
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
 * 点击打开菜单：有多个来源时可切换（选择某个来源即为这首歌固定该来源，下次播放仍使用；选择「自动」按等级选择），
 * 并始终可以「重新获取歌词」（重新从所有来源获取，获取失败或歌词不对时使用）；
 * 更高等级的来源仍在请求中时显示加载图标；叠加了 AI 歌词标注时在最前面显示 AI 标志，正在生成时标志呼吸闪烁。
 * 全站默认来源（spec 7.2n）：管理员在这里选择来源即设为全站默认（选「自动」取消），所有读者默认显示它；
 * 读者的选择只保存在本地，有全站默认来源时读者的「自动」显示为「默认（站长选择）」
 */
export function LyricSourceBadge({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { lyrics, lyricStatus, lyricCandidates, lyricKind, lyricPin, setLyricPin, lyricSourcesPending, refreshLyrics, lyricAnnotated, lyricAnnotationsGenerating, currentTrack } = useMusic()
  const { user } = useAuth()
  const admin = !!user && isAdmin({ user })
  const trackId = currentTrack?.id ?? 0
  const sitePin = useLyricSitePin(trackId > 0 ? trackId : null)
  if (lyricStatus === 'loading')
    return null

  const selectSource = (value: string) => {
    const kind = value === AUTO ? null : value as LyricSourceKind
    if (!admin) {
      setLyricPin(kind)
      return
    }
    // 管理员：设为全站默认，并清除自己在本地固定的来源，看到的就是全站的版本
    setLyricPin(null)
    setLyricSitePin(trackId, kind)
      .then(() => toast.success(t(kind ? 'lyric_site_pin_saved' : 'lyric_site_pin_cleared')))
      .catch(() => toast.error(t('lyric_site_pin_failed')))
  }

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

  const switchable = lyricCandidates.length > 1 || lyricPin != null || sitePin != null
  const selected = admin ? sitePin ?? AUTO : lyricPin ?? AUTO
  const pinned = admin ? sitePin != null : lyricPin != null
  const badge = (
    <span className="inline-flex h-[1.125rem] items-center gap-1 rounded-full bg-white/10 px-1.5 text-[10px] leading-none font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white/90">
      {/* AI 歌词特效：生成中（首次或重新生成）时标志呼吸闪烁 */}
      {(lyricAnnotated || lyricAnnotationsGenerating) && (
        <span title={t(lyricAnnotationsGenerating ? 'lyric_badge_ai_generating' : 'lyric_badge_ai_effects')} className="inline-flex shrink-0">
          <SparklesIcon aria-hidden className={cn('size-3', lyricAnnotationsGenerating && 'motion-safe:animate-pulse')} />
          <span className="sr-only">{t(lyricAnnotationsGenerating ? 'lyric_badge_ai_generating' : 'lyric_badge_ai_effects')}</span>
        </span>
      )}
      {/* 来源标志：网易云、QQ 音乐、AMLL 等各自的标志，统一为与文字相同的单色 */}
      <LyricSourceIcon source={lyrics.lines.length > 0 ? lyrics.source : 'none'} className="size-3 shrink-0" />
      <span className="sr-only">{t('lyric_badge_label')}</span>
      {describe(lyrics)}
      {pinned && <PinIcon aria-label={t(admin ? 'lyric_badge_site_pinned' : 'lyric_badge_pinned')} className="size-2.5 shrink-0" />}
      {lyricSourcesPending && <LoaderCircleIcon aria-label={t('lyric_badge_upgrading')} className="size-2.5 shrink-0 motion-safe:animate-spin" />}
      <ChevronDownIcon aria-hidden className="-mr-0.5 size-2.5 shrink-0" />
    </span>
  )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        title={t(switchable ? 'lyric_badge_switch' : 'lyric_badge_label')}
        // className 加在外层：页面用它控制标签在网格中的位置（移动端居中）
        className={cn('inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none', className)}
      >
        {badge}
      </DropdownMenuTrigger>
      {/* 播放器页固定为深色界面；下拉菜单渲染在 body 下，单独加 dark。层级高于悬浮播放器的弹层（z-1000） */}
      <DropdownMenuContent align="start" className="dark z-1001 min-w-56 border-white/10 bg-neutral-900/95 text-white backdrop-blur-xl">
        {switchable && (
          <>
            <DropdownMenuLabel className="grid text-xs text-white/60">
              {t(admin ? 'lyric_badge_switch_site' : 'lyric_badge_switch')}
              {admin && <span className="text-[11px] font-normal text-white/40">{t('lyric_badge_switch_site_hint')}</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuRadioGroup value={selected} onValueChange={selectSource}>
              <DropdownMenuRadioItem value={AUTO} className="text-xs">
                <span className="grid">
                  {t(!admin && sitePin ? 'lyric_badge_site_default' : 'lyric_badge_auto')}
                  {lyricKind && selected === AUTO && <span className="text-[11px] text-white/50">{describe(lyrics)}</span>}
                </span>
              </DropdownMenuRadioItem>
              {lyricCandidates.map(candidate => (
                <DropdownMenuRadioItem key={candidate.kind} value={candidate.kind} className="gap-2 text-xs">
                  <LyricSourceIcon source={candidate.lyrics.source} className="size-3.5 shrink-0 text-white/80" />
                  {describe(candidate.lyrics)}
                  {!admin && candidate.kind === sitePin && <span className="ml-auto text-[11px] text-white/50">{t('lyric_badge_site_tag')}</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator className="bg-white/10" />
          </>
        )}
        {/* 重新从所有来源获取（获取失败或歌词不对时）；获取期间显示加载并暂时不可点 */}
        <DropdownMenuItem disabled={lyricSourcesPending} onSelect={refreshLyrics} className="gap-2 text-xs">
          <RotateCwIcon aria-hidden className={cn('size-3.5 shrink-0 text-white/80', lyricSourcesPending && 'motion-safe:animate-spin')} />
          <span className="grid">
            {t('lyric_refresh')}
            <span className="text-[11px] text-white/50">{t('lyric_refresh_hint')}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
