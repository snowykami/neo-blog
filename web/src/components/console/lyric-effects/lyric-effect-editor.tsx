'use client'

import type { MusicLyricAnnotationEditor } from '@/api/music'
import type { AnnotationForm } from '@/lib/lyrics/annotation-edit'
import type { MusicSong } from '@/models/music'
import type { BaseResponseError } from '@/models/resp'
import { isAxiosError } from 'axios'
import { ArrowLeftIcon, EyeIcon, RefreshCwIcon, SaveIcon } from 'lucide-react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { fetchLyricAnnotationEditor, getMusicSong, refreshLyricAnnotations, saveLyricAnnotations } from '@/api/music'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Skeleton } from '@/components/ui/skeleton'
import { reloadAnnotations } from '@/contexts/lyric-annotations'
import { fromAnnotationForm, toAnnotationForm, uniqueLyricLines } from '@/lib/lyrics/annotation-edit'
import { getErrorMessage } from '@/utils/common/error'
import { consolePath } from '@/utils/common/route'
import { LyricCanvas } from './lyric-canvas'
import { EffectLegendPanel, LineSettingsPanel, SongSettingsPanel } from './lyric-settings-panels'
import './lyric-effect-editor.css'

// AI 重新生成时每隔 POLL_MS 查一次，最多等 3 分钟
const POLL_MS = 2000
const MAX_POLLS = 90

const EMPTY_FORM: AnnotationForm = { font: '', pace: 'medium', intro: '', spotlight: null, lines: [] }

/**
 * 后台歌词特效编辑器（见 spec 7.2b「手动编辑」）：查看并手动修改一首歌的 AI 歌词标注。只能选区加特效、改各行与全曲的设置，
 * 不能改歌词与时间轴；保存后记为手动编辑，不再因过期自动重新生成。也可以让 AI 重新生成（覆盖手动编辑的内容）
 */
export function LyricEffectEditor() {
  const t = useTranslations('Console.lyric_effects')
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  // 刚保存或生成的时间可能晚于每分钟更新一次的 now，按「刚刚」显示
  const ago = (time: string) => format.relativeTime(new Date(time), Math.max(now.getTime(), Date.parse(time)))
  const { id } = useParams() as { id: string }
  const songId = Number(id)
  const [data, setData] = React.useState<MusicLyricAnnotationEditor | null>(null)
  const [song, setSong] = React.useState<MusicSong | null>(null)
  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [activeLine, setActiveLine] = React.useState(0)
  const [regenerating, setRegenerating] = React.useState(false)
  const form = useForm<AnnotationForm>({ defaultValues: EMPTY_FORM })
  const { isDirty, isSubmitting } = form.formState
  const unique = React.useMemo(() => uniqueLyricLines(data?.lines ?? []), [data?.lines])

  const apply = React.useCallback((editor: MusicLyricAnnotationEditor) => {
    setData(editor)
    form.reset(toAnnotationForm(editor.lines, editor.annotation))
  }, [form])

  const load = React.useCallback(() => {
    setLoadState('loading')
    getMusicSong(songId).then(setSong, () => setSong(null))
    fetchLyricAnnotationEditor(songId).then((editor) => {
      apply(editor)
      setLoadState('ready')
    }, (error: unknown) => {
      setLoadState(isAxiosError(error) && error.response?.status === 404 ? 'unavailable' : 'error')
    })
  }, [apply, songId])

  React.useEffect(() => {
    if (Number.isInteger(songId) && songId > 0)
      load()
    else
      setLoadState('unavailable')
  }, [load, songId])

  // 有未保存的修改时，离开页面前提示
  React.useEffect(() => {
    if (!isDirty)
      return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  const save = form.handleSubmit(async (values) => {
    if (!data)
      return
    try {
      apply(await saveLyricAnnotations(songId, fromAnnotationForm(data.lines, values)))
      // 本页的播放器已取过这首歌的标注时重新取
      reloadAnnotations(songId)
      toast.success(t('saved'))
    }
    catch (error) {
      toast.error(`${t('save_failed')}: ${getErrorMessage(error as BaseResponseError)}`)
    }
  })

  // AI 重新生成：后台开始生成后轮询，生成完成（不再 generating）时载入新结果
  const regenerate = async () => {
    setRegenerating(true)
    try {
      await refreshLyricAnnotations(songId)
      toast.success(t('regenerate_started'))
      for (let polls = 0; polls < MAX_POLLS; polls++) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS))
        const editor = await fetchLyricAnnotationEditor(songId)
        if (!editor.generating) {
          apply(editor)
          reloadAnnotations(songId)
          break
        }
      }
    }
    catch (error) {
      toast.error(`${t('regenerate_failed')}: ${getErrorMessage(error as BaseResponseError)}`)
    }
    finally {
      setRegenerating(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-[60vh]" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }
  if (loadState !== 'ready' || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-sm text-muted-foreground">
        <span>{t(loadState === 'unavailable' ? 'unavailable' : 'load_failed')}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild><Link href={consolePath.lyricEffect}>{t('back')}</Link></Button>
          {loadState === 'error' && <Button size="sm" variant="outline" onClick={load}>{t('retry')}</Button>}
        </div>
      </div>
    )
  }

  const generating = regenerating || data.generating
  return (
    <Form {...form}>
      <form onSubmit={save} className="grid gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="icon-sm" asChild>
            <Link href={consolePath.lyricEffect} aria-label={t('back')} title={t('back')}><ArrowLeftIcon className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{song?.name ?? t('unknown_song', { id: songId })}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {song && <span className="truncate">{song.artists.join(' / ')}</span>}
              {generating && <Badge className="bg-violet-100 text-violet-800 motion-safe:animate-pulse">{t('generating')}</Badge>}
              {!generating && !data.annotation && <Badge variant="outline">{t('status_none')}</Badge>}
              {data.editedAt && <span>{t('edited_at', { time: ago(data.editedAt) })}</span>}
              {!data.editedAt && data.generatedAt && <span>{t('generated_at', { time: ago(data.generatedAt), model: data.model ?? '' })}</span>}
              {isDirty && <Badge variant="outline" className="border-amber-400 text-amber-600">{t('unsaved')}</Badge>}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={`/music?id=${songId}`} target="_blank" rel="noreferrer">
                <EyeIcon className="size-4" />
                {t('preview')}
              </a>
            </Button>
            <ConfirmDialog
              title={t('regenerate_title')}
              description={t('regenerate_description')}
              confirmLabel={t('regenerate')}
              confirmVariant="destructive"
              onConfirm={() => void regenerate()}
            >
              <Button type="button" size="sm" variant="outline" disabled={generating}>
                <RefreshCwIcon className={generating ? 'size-4 motion-safe:animate-spin' : 'size-4'} />
                {t('regenerate')}
              </Button>
            </ConfirmDialog>
            <Button type="submit" size="sm" disabled={!isDirty || isSubmitting || generating}>
              <SaveIcon className="size-4" />
              {t('save')}
            </Button>
          </div>
        </header>
        {!data.annotation && !generating && <p className="text-sm text-muted-foreground">{t('no_annotation')}</p>}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <LyricCanvas unique={unique} activeLine={activeLine} onActiveLineChange={setActiveLine} />
          <aside className="grid gap-4 lg:sticky lg:top-4">
            <LineSettingsPanel key={activeLine} index={activeLine} line={unique[activeLine]} sprites={data.annotation?.sprites} />
            <SongSettingsPanel lines={data.lines} />
            <EffectLegendPanel />
          </aside>
        </div>
      </form>
    </Form>
  )
}
