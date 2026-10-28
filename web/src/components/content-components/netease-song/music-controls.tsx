'use client'

import type { CardAudioStatus } from '../use-card-audio'
import { ExternalLinkIcon, PauseIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * 音乐组件（音乐卡片、歌词摘录）统一的播放按钮：播放 / 暂停 / 缓冲中 / 加载失败（点击重试）
 * 缓冲中仍可点击，用于取消播放
 */
export function MusicPlayButton({ status, onClick, className }: { status: CardAudioStatus, onClick: () => void, className?: string }) {
  const t = useTranslations('ContentComponents.neteaseSong')
  const label = status === 'error'
    ? t('audio_error_retry')
    : status === 'loading'
      ? t('buffering')
      : t(status === 'playing' ? 'pause' : 'play')
  return (
    <Button
      type="button"
      size="icon"
      variant={status === 'error' ? 'outline' : 'default'}
      className={cn('size-10 shrink-0 rounded-full', status === 'error' && 'text-destructive hover:text-destructive', className)}
      aria-label={label}
      aria-busy={status === 'loading' || undefined}
      title={label}
      onClick={onClick}
    >
      {status === 'error'
        ? <TriangleAlertIcon />
        : status === 'loading'
          ? <Spinner />
          : status === 'playing'
            ? <PauseIcon />
            : <PlayIcon className="translate-x-px" />}
    </Button>
  )
}

/** 不在博客歌单内的网易云歌曲：站内不能播放，链接到网易云收听（音乐卡片与歌词摘录共用） */
export function NeteaseOpenButton({ href }: { href: string }) {
  const t = useTranslations('ContentComponents.neteaseSong')
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <a href={href} target="_blank" rel="noopener noreferrer" title={t('not_in_playlist')}>
        <ExternalLinkIcon />
        {t('open')}
      </a>
    </Button>
  )
}
