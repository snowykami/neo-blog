'use client'

import type { MusicLyricAnnotationSummary } from '@/api/music'
import type { MusicTrack } from '@/models/music'
import type { BaseResponseError } from '@/models/resp'
import { Eye, Music2Icon, PencilLine } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fetchPlaylist, listLyricAnnotations } from '@/api/music'
import { SafeImage } from '@/components/common/safe-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useOperationT } from '@/hooks/use-translations'
import { getErrorMessage } from '@/utils/common/error'
import { consolePath } from '@/utils/common/route'

interface LyricEffectRow {
  id: number
  track?: MusicTrack
  summary?: MusicLyricAnnotationSummary
}

/**
 * 后台歌词特效列表：博客歌单中的歌曲与已有标注的歌曲（如文章引用的歌曲），显示标注状态（未生成 / AI 生成 / 手动编辑过）；
 * 点击进入编辑器。不在列表里的歌曲（文章引用、还没生成标注）可以按网易云歌曲 ID 打开
 */
export function LyricEffectManage() {
  const t = useTranslations('Console.lyric_effects')
  const operationT = useOperationT()
  const router = useRouter()
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [summaries, setSummaries] = useState<MusicLyricAnnotationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState('')

  useEffect(() => {
    // 静态歌单（或网易云未配置）时歌单接口失败，只列出已有标注的歌曲
    Promise.allSettled([fetchPlaylist({ type: 'ncm' }), listLyricAnnotations()]).then(([playlist, annotations]) => {
      if (playlist.status === 'fulfilled')
        setTracks(playlist.value)
      if (annotations.status === 'fulfilled')
        setSummaries(annotations.value)
      else
        toast.error(`${operationT('fetch_failed')}: ${getErrorMessage(annotations.reason as BaseResponseError)}`)
      setLoading(false)
    })
  }, [operationT])

  const rows = useMemo(() => {
    const byId = new Map<number, LyricEffectRow>()
    for (const track of tracks)
      byId.set(track.id, { id: track.id, track })
    for (const summary of summaries)
      byId.set(summary.songId, { ...byId.get(summary.songId), id: summary.songId, summary })
    const keyword = query.trim().toLowerCase()
    return [...byId.values()].filter(row => !keyword
      || String(row.id).includes(keyword)
      || row.track?.name.toLowerCase().includes(keyword)
      || row.track?.artists.some(artist => artist.toLowerCase().includes(keyword)))
  }, [query, summaries, tracks])

  const openById = (event: React.FormEvent) => {
    event.preventDefault()
    const id = Number(openId.trim())
    if (Number.isInteger(id) && id > 0)
      router.push(`${consolePath.lyricEffect}/${id}`)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          placeholder={t('search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <form onSubmit={openById} className="flex gap-2">
          <Input
            inputMode="numeric"
            placeholder={t('open_by_id')}
            value={openId}
            onChange={event => setOpenId(event.target.value)}
            className="w-44"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!/^\d+$/.test(openId.trim())}>{t('open')}</Button>
        </form>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{t('description')}</p>
      <Separator />
      {!loading && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</div>}
      {rows.map(row => (
        <div key={row.id}>
          <LyricEffectItem row={row} />
          <Separator />
        </div>
      ))}
    </div>
  )
}

function LyricEffectItem({ row }: { row: LyricEffectRow }) {
  const t = useTranslations('Console.lyric_effects')
  const operationT = useOperationT()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const { summary, track } = row
  const editUrl = `${consolePath.lyricEffect}/${row.id}`
  return (
    <div className="flex w-full items-center gap-3 py-3">
      <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted">
        {track?.albumPic
          ? <SafeImage src={track.albumPic} alt="" fill sizes="44px" className="object-cover" />
          : <Music2Icon className="absolute inset-0 m-auto size-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0">
        <Link href={editUrl} className="block truncate text-sm font-medium hover:underline">
          {track?.name ?? t('unknown_song', { id: row.id })}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {track && <span className="truncate text-xs text-muted-foreground">{track.artists.join(' / ')}</span>}
          <Badge variant="secondary">
            ID:
            {row.id}
          </Badge>
          {!summary && <Badge variant="outline">{t('status_none')}</Badge>}
          {summary && !summary.editedAt && <Badge className="bg-violet-100 text-violet-800">{t('status_ai')}</Badge>}
          {summary?.editedAt && <Badge className="bg-green-100 text-green-800">{t('status_edited')}</Badge>}
          {/* 全站歌词版本已更换（spec 7.2o）：显示的标注属于旧版本，或有旧版本的手动编辑不再显示 */}
          {summary?.outdated && <Badge className="bg-amber-100 text-amber-800" title={t('status_outdated_hint')}>{t('status_outdated')}</Badge>}
          {summary?.outdatedEditedAt && <Badge className="bg-amber-100 text-amber-800" title={t('status_outdated_edit_hint')}>{t('status_outdated_edit')}</Badge>}
          {summary && <Badge variant="outline">{t('phrase_count', { count: summary.phrases })}</Badge>}
          {summary && (
            <span className="text-xs text-muted-foreground">
              {/* 刚保存的时间可能晚于每分钟更新一次的 now，按「刚刚」显示 */}
              {format.relativeTime(new Date(summary.editedAt ?? summary.generatedAt), Math.max(now.getTime(), Date.parse(summary.editedAt ?? summary.generatedAt)))}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={`/music?id=${row.id}`} target="_blank" rel="noreferrer" aria-label={t('preview')} title={t('preview')}>
            <Eye className="size-4" />
          </a>
        </Button>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href={editUrl} aria-label={operationT('edit')} title={operationT('edit')}>
            <PencilLine className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
