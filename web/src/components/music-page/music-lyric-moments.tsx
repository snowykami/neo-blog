'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useSyncExternalStore } from 'react'
import { useMusic, useMusicClockStore } from '@/contexts/music-context'
import { lyricMomentAt } from '@/lib/lyrics/moments'
import { cn } from '@/lib/utils'

/**
 * 歌词区底部的「时刻」（播放器页与悬浮小窗，compact 时字号更小，均来自歌词标注，时机见 lib/lyrics/moments.ts）：
 * 前奏时淡入 AI 写给听众的一句导语；关键节点开唱时淡入 AI 挑选的热评或写的旁白；尾奏时淡入一条最贴合歌曲的网易云热评。
 * 只订阅播放时钟换算出的时刻（前奏 / 尾奏 / 无），时刻不变时不重渲染；读者在控制栏关掉「评论与旁白」后不显示
 */
export function MusicLyricMoments({ className, compact = false }: { className?: string, compact?: boolean }) {
  const t = useTranslations('MusicPage')
  const format = useFormatter()
  const { lyrics, duration, showLyricMoments } = useMusic()
  const clock = useMusicClockStore()
  const getMoment = useCallback(
    () => lyricMomentAt(lyrics, clock.getSnapshot() * 1000, duration == null ? null : duration * 1000),
    [clock, duration, lyrics],
  )
  const moment = useSyncExternalStore(clock.subscribe, getMoment, () => null)
  const notes = lyrics.notes ?? []
  if (!showLyricMoments || (!lyrics.intro && !lyrics.outro && notes.length === 0))
    return null
  const caption = (liked: number) => t('outro_source', { count: format.number(liked, { notation: 'compact' }) })

  return (
    <div aria-live="polite" className={cn('pointer-events-none relative grid place-items-end px-2', className)}>
      {lyrics.intro && <Narration text={lyrics.intro} visible={moment === 'intro'} compact={compact} />}
      {notes.map((note, i) => note.source === 'comment'
        ? <CommentQuote key={`${note.start}-${i}`} content={note.content} caption={caption(note.liked ?? 0)} visible={moment === `note:${i}`} compact={compact} />
        : <Narration key={`${note.start}-${i}`} text={note.content} visible={moment === `note:${i}`} compact={compact} />)}
      {lyrics.outro && <CommentQuote content={lyrics.outro.content} caption={caption(lyrics.outro.liked)} visible={moment === 'outro'} compact={compact} />}
    </div>
  )
}

/** 旁白（前奏导语、模型写的时刻）：斜体，淡入淡出 */
function Narration({ text, visible, compact }: { text: string, visible: boolean, compact: boolean }) {
  return (
    <p
      className={cn(
        'col-start-1 row-start-1 max-w-xl text-center leading-relaxed font-medium text-white/80 italic transition-opacity duration-1000',
        compact ? 'text-xs' : 'text-lg lg:text-left lg:text-xl',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {text}
    </p>
  )
}

/** 一条网易云热评（尾奏、热评时刻）：引号 + 来源与点赞数，淡入淡出 */
function CommentQuote({ content, caption, visible, compact }: { content: string, caption: string, visible: boolean, compact: boolean }) {
  return (
    <figure
      className={cn(
        'col-start-1 row-start-1 grid max-w-xl text-center transition-opacity duration-1000',
        compact ? 'gap-0.5' : 'gap-1.5 lg:text-left',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <blockquote className={cn('leading-relaxed text-white/80', compact ? 'text-xs' : 'text-base lg:text-lg')}>{`「${content}」`}</blockquote>
      <figcaption className={cn('text-white/45', compact ? 'text-[10px]' : 'text-xs')}>{caption}</figcaption>
    </figure>
  )
}
