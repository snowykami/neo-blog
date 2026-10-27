'use client'

import type { MusicSearchSong } from '@/models/music'
import { CheckIcon, Music2Icon, SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { searchMusicSongs } from '@/api/music'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { formatDurationMMSS } from '@/utils/common/datetime'

type Status = { type: 'idle' } | { type: 'busy' } | { type: 'message', key: 'no_results' | 'failed', error?: boolean }

/**
 * 网易云歌曲搜索：音乐卡片与歌词摘录共用
 * 通过后端（配置的网易云 API 或网易云公开搜索）按关键词搜索，点击结果填入歌曲 ID；
 * 博客歌单内的歌曲会标出，只有这些歌曲可在站内播放
 */
export function NeteaseSongSearch({ value, onSelect }: { value: number, onSelect: (song: MusicSearchSong) => void }) {
  const t = useTranslations('ContentComponents.neteaseSong.action')
  const [query, setQuery] = useState('')
  const [songs, setSongs] = useState<MusicSearchSong[] | null>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const busy = status.type === 'busy'

  const search = async () => {
    const keywords = query.trim()
    if (!keywords || busy)
      return
    setStatus({ type: 'busy' })
    try {
      const result = await searchMusicSongs(keywords)
      setSongs(result)
      setStatus(result.length ? { type: 'idle' } : { type: 'message', key: 'no_results' })
    }
    catch {
      setStatus({ type: 'message', key: 'failed', error: true })
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-sm font-medium">{t('title')}</span>
        <span className="text-xs text-muted-foreground">{t('hint')}</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          maxLength={50}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 回车搜索，不提交属性表单
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={busy || !query.trim()} onClick={() => void search()}>
          {busy ? <Spinner /> : <SearchIcon />}
          {t('search')}
        </Button>
      </div>
      {songs && songs.length > 0 && (
        <ul className="grid max-h-64 gap-1 overflow-y-auto" aria-label={t('results')}>
          {songs.map((song) => {
            const selected = value === song.id
            return (
              <li key={song.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected && 'bg-primary/10 hover:bg-primary/10',
                  )}
                  onClick={() => onSelect(song)}
                >
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {song.albumPic
                      ? <SafeImage src={song.albumPic} alt="" fill sizes="40px" className="object-cover" />
                      : <Music2Icon className="absolute inset-0 m-auto size-4 text-muted-foreground" />}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">
                      {song.name}
                      {song.aliases.length > 0 && <span className="ml-1 font-normal text-muted-foreground">{`(${song.aliases.join(', ')})`}</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{[song.artists.join(' / '), song.album].filter(Boolean).join(' · ')}</span>
                  </span>
                  {song.inPlaylist && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">{t('in_playlist')}</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{song.duration > 0 ? formatDurationMMSS(Math.round(song.duration / 1000)) : ''}</span>
                  {selected && <CheckIcon aria-label={t('selected')} className="size-4 shrink-0 text-primary" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {status.type === 'message' && (
        <p className={status.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{t(status.key)}</p>
      )}
    </div>
  )
}
