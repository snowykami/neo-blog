'use client'

import type { LyricSourceKind } from '@/lib/lyrics/resolve'
import type { LyricSource, ResolvedLyrics } from '@/lib/lyrics/types'
import { CaseSensitiveIcon, ChevronDownIcon, LanguagesIcon, LoaderCircleIcon, PinIcon, RotateCwIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { reloadAnnotations, useLyricAnnotations } from '@/contexts/lyric-annotations'
import { setLyricSitePin, useLyricSitePin } from '@/contexts/lyric-settings'
import { useMusic } from '@/contexts/music-context'
import { setSongLyricVersion } from '@/contexts/song-lyrics'
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

/** 歌词来源的名称：自定义 TTML 源有名称时用它，否则为来源的通用名称（t 为 MusicPage 命名空间）；没有歌词时为 null */
export function lyricSourceLabel(lyrics: Pick<ResolvedLyrics, 'source' | 'sourceName'>, t: (key: string) => string): string | null {
  if (lyrics.source === 'none')
    return null
  return lyrics.sourceName || t(SOURCE_KEYS[lyrics.source])
}

const AUTO = 'auto'

/**
 * 歌词来源标签：来源的标志 + 「来源 · 逐字 / 逐行 · 翻译 · 音译」（功能与 StarryPlayer 播放页的歌词标签一致，外观为我们自己的单色标志样式）。
 * 只有管理员看得到（spec 7.2n）：读者不选歌词，一律显示全站版本（管理员为这首歌选定的来源，没有选定时按质量自动选择）。
 * 点击打开菜单：有多个来源时可切换，选择某个来源即设为这首歌的全站默认来源（选「自动」改为按等级选择），
 * 并始终可以「重新获取歌词」（重新从所有来源获取，获取失败或歌词不对时使用）；
 * 更高等级的来源仍在请求中时显示加载图标；叠加了 AI 歌词标注时在最前面显示 AI 标志，正在生成时标志呼吸闪烁。
 * 设为全站默认后后端立即按它重新选出全站歌词版本并生成歌词特效；当前的特效在后台手动编辑过时先确认（切换后不再显示，切换回来时恢复）
 */
export function LyricSourceBadge({ className }: { className?: string }) {
  const t = useTranslations('MusicPage')
  const { lyrics, lyricStatus, lyricCandidates, lyricKind, lyricSourcesPending, refreshLyrics, lyricAnnotated, lyricAnnotationsGenerating, lyricAiTranslated, lyricTranslationsGenerating, lyricAiRomanized, lyricPronunciationsGenerating, currentTrack } = useMusic()
  const { user } = useAuth()
  const admin = !!user && isAdmin({ user })
  const trackId = currentTrack?.id ?? 0
  const sitePin = useLyricSitePin(trackId > 0 ? trackId : null)
  const annotationsEdited = useLyricAnnotations(trackId > 0 ? trackId : null)?.edited ?? false
  // 等待确认的全站来源切换（当前特效手动编辑过）
  const [confirmKind, setConfirmKind] = useState<LyricSourceKind | typeof AUTO | null>(null)
  // 读者不参与歌词选择：没有这个标签，按全站版本显示即可
  if (!admin || lyricStatus === 'loading')
    return null

  const saveSitePin = (kind: LyricSourceKind | null) => {
    // 设为全站默认：后端返回重新选出的全站版本，按新版本重新取歌词特效
    setLyricSitePin(trackId, kind)
      .then((version) => {
        setSongLyricVersion(trackId, version)
        reloadAnnotations(trackId)
        toast.success(t(kind ? 'lyric_site_pin_saved' : 'lyric_site_pin_cleared'))
      })
      .catch(() => toast.error(t('lyric_site_pin_failed')))
  }

  const selectSource = (value: string) => {
    const kind = value === AUTO ? null : value as LyricSourceKind
    if (annotationsEdited && value !== (sitePin ?? AUTO)) {
      setConfirmKind(kind ?? AUTO)
      return
    }
    saveSitePin(kind)
  }

  const describe = (target: ResolvedLyrics) => {
    if (target.source === 'none' || target.lines.length === 0)
      return t(target.instrumental ? 'lyric_badge_instrumental' : 'lyric_badge_none')
    return [
      lyricSourceLabel(target, t),
      t(target.wordTimed ? 'lyric_badge_word' : 'lyric_badge_line'),
      (target.source === lyrics.source && (lyricAiTranslated || lyricTranslationsGenerating))
        ? t('lyric_badge_ai_translation')
        : target.lines.some(line => line.translation) && t('lyric_badge_translation'),
      (target.source === lyrics.source && (lyricAiRomanized || lyricPronunciationsGenerating))
        ? t('lyric_badge_ai_romanization')
        : target.lines.some(line => line.romanization) && t('lyric_badge_romanization'),
    ].filter(Boolean).join(' · ')
  }

  const switchable = lyricCandidates.length > 1 || sitePin != null
  const selected = sitePin ?? AUTO
  const pinned = sitePin != null
  const badge = (
    <span className="inline-flex h-[1.125rem] items-center gap-1 rounded-full bg-white/10 px-1.5 text-[10px] leading-none font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white/90">
      {/* AI 歌词特效：生成中（首次或重新生成）时标志呼吸闪烁 */}
      {(lyricAnnotated || lyricAnnotationsGenerating) && (
        <span title={t(lyricAnnotationsGenerating ? 'lyric_badge_ai_generating' : 'lyric_badge_ai_effects')} className="inline-flex shrink-0">
          <SparklesIcon aria-hidden className={cn('size-3', lyricAnnotationsGenerating && 'motion-safe:animate-pulse')} />
          <span className="sr-only">{t(lyricAnnotationsGenerating ? 'lyric_badge_ai_generating' : 'lyric_badge_ai_effects')}</span>
        </span>
      )}
      {(lyricAiTranslated || lyricTranslationsGenerating) && (
        <span title={t('lyric_badge_ai_translation')} className="inline-flex shrink-0">
          <LanguagesIcon aria-hidden className={cn('size-3', lyricTranslationsGenerating && 'motion-safe:animate-pulse')} />
          <span className="sr-only">{t('lyric_badge_ai_translation')}</span>
        </span>
      )}
      {(lyricAiRomanized || lyricPronunciationsGenerating) && (
        <span title={t('lyric_badge_ai_romanization')} className="inline-flex shrink-0">
          <CaseSensitiveIcon aria-hidden className={cn('size-3', lyricPronunciationsGenerating && 'motion-safe:animate-pulse')} />
          <span className="sr-only">{t('lyric_badge_ai_romanization')}</span>
        </span>
      )}
      {/* 来源标志：网易云、QQ 音乐、AMLL 等各自的标志，统一为与文字相同的单色 */}
      <LyricSourceIcon source={lyrics.lines.length > 0 ? lyrics.source : 'none'} className="size-3 shrink-0" />
      <span className="sr-only">{t('lyric_badge_label')}</span>
      {describe(lyrics)}
      {pinned && <PinIcon aria-label={t('lyric_badge_site_pinned')} className="size-2.5 shrink-0" />}
      {lyricSourcesPending && <LoaderCircleIcon aria-label={t('lyric_badge_upgrading')} className="size-2.5 shrink-0 motion-safe:animate-spin" />}
      <ChevronDownIcon aria-hidden className="-mr-0.5 size-2.5 shrink-0" />
    </span>
  )

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          title={t(switchable ? 'lyric_badge_switch_site' : 'lyric_badge_label')}
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
                {t('lyric_badge_switch_site')}
                <span className="text-[11px] font-normal text-white/40">{t('lyric_badge_switch_site_hint')}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuRadioGroup value={selected} onValueChange={selectSource}>
                <DropdownMenuRadioItem value={AUTO} className="text-xs">
                  <span className="grid">
                    {t('lyric_badge_auto')}
                    {lyricKind && selected === AUTO && <span className="text-[11px] text-white/50">{describe(lyrics)}</span>}
                  </span>
                </DropdownMenuRadioItem>
                {lyricCandidates.map(candidate => (
                  <DropdownMenuRadioItem key={candidate.kind} value={candidate.kind} className="gap-2 text-xs">
                    <LyricSourceIcon source={candidate.lyrics.source} className="size-3.5 shrink-0 text-white/80" />
                    {describe(candidate.lyrics)}
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
      <ConfirmDialog
        open={confirmKind != null}
        onOpenChange={open => !open && setConfirmKind(null)}
        title={t('lyric_site_switch_edited_title')}
        description={t('lyric_site_switch_edited_description')}
        confirmLabel={t('lyric_site_switch_confirm')}
        confirmVariant="destructive"
        onConfirm={() => {
          if (confirmKind != null)
            saveSitePin(confirmKind === AUTO ? null : confirmKind)
          setConfirmKind(null)
        }}
      />
    </>
  )
}
