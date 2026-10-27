'use client'

import type { ContentEditorActionProps } from '../types'
import type { LyricQuoteInput } from './schema'
import type { MusicLyrics } from '@/api/music'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { QuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { fetchNcmLyric } from '@/api/music'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { getExtraLyricLine, LYRIC_PLACEHOLDERS, parseMusicLyrics } from '@/utils/music-lyric'
import { NeteaseSongSearch } from '../netease-song/netease-song-search'
import { useCachedRequest } from '../use-cached-request'

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function toMs(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0
}

/** 过滤歌词接口返回的占位文本，避免把 no_lyric 当作翻译/发音展示 */
function cleanLyricLines(lines: MusicLyricLine[]): MusicLyricLine[] {
  return lines.filter(line => !LYRIC_PLACEHOLDERS.has(line.originalText.trim()))
}

/**
 * 歌词摘录的「选择歌词」：复用音乐卡片的网易云歌曲搜索选择音源，再按行选择歌词；
 * 依次点击起始句和结束句，选中后把时间点与歌词文本写回表单
 */
export default function LyricQuoteAction({ values, setValues }: ContentEditorActionProps<LyricQuoteInput>) {
  const t = useTranslations('ContentComponents.lyricQuote.action')
  const source = values.source ?? 'netease'
  const id = Number(values.id) || 0
  const authorLyric = values.lyric?.trim() ?? ''
  const authorTranslation = values.translation?.trim() ?? ''
  const authorRomaji = values.romaji?.trim() ?? ''
  // 网易云模式：作者未填写歌词且已选择歌曲时，按歌曲 ID 拉取歌词用于选句
  const fetchLyric = source === 'netease' && id > 0 && !authorLyric
  const lyricState = useCachedRequest(fetchLyric ? `ncm-lyric:${id}` : null, () => fetchNcmLyric(id))

  const parsed = useMemo(() => {
    try {
      const fetched = fetchLyric && lyricState.status === 'success' ? lyricState.data : null
      let raw: MusicLyrics | null = fetched
      if (authorLyric) {
        raw = {
          ...(fetched ?? {}),
          lrc: { lyric: authorLyric, version: 1 },
          yrc: null,
        }
      }
      if (authorTranslation) {
        raw = {
          ...(raw ?? {}),
          tlyric: { lyric: authorTranslation, version: 1 },
          ytlrc: null,
        }
      }
      if (authorRomaji) {
        raw = {
          ...(raw ?? {}),
          romalrc: { lyric: authorRomaji, version: 1 },
          yromalrc: null,
        }
      }
      return raw ? parseMusicLyrics(raw) : null
    }
    catch {
      return null
    }
  }, [authorLyric, authorRomaji, authorTranslation, fetchLyric, lyricState])

  const lines = useMemo(() => cleanLyricLines(parsed?.lines ?? []), [parsed])
  const translationLines = cleanLyricLines(parsed?.translationLines ?? [])
  const romajiLines = cleanLyricLines(parsed?.romajiLines ?? [])

  const start = toMs(values.start)
  const end = toMs(values.end)
  // 第一句可能正好在 0 毫秒，用歌词文本快照判断是否已经选择过
  const hasSelection = start > 0 || Boolean(values.text?.trim())

  const selectLine = (line: MusicLyricLine) => {
    // 没有选择，或已经选完一段时，点击都表示重新选择起始句
    if (!hasSelection || end > 0) {
      setValues({ start: line.startTime, end: 0, text: line.originalText })
      return
    }

    // 已选起始句：后面的句子作为结束句
    if (line.startTime > start) {
      const startIndex = lines.findIndex(item => item.startTime === start)
      const endIndex = lines.findIndex(item => item.startTime === line.startTime)
      const selectedText = startIndex >= 0 && endIndex >= startIndex
        ? lines.slice(startIndex, endIndex + 1).map(item => item.originalText).join('\n')
        : line.originalText
      setValues({ end: line.startTime, text: selectedText })
      return
    }

    // 第二次点在更早的句子上：把它作为新的起始句
    setValues({ start: line.startTime, end: 0, text: line.originalText })
  }

  // 歌词列表的占位提示：优先说明缺少的前置条件，再显示加载 / 失败状态
  const lineHint = (() => {
    if (source === 'custom' && !authorLyric)
      return t('need_lyric')
    if (fetchLyric && lyricState.status === 'loading')
      return t('loading')
    if (fetchLyric && lyricState.status === 'error')
      return t('failed')
    if (source === 'netease' && id <= 0)
      return t('need_song')
    if (lines.length === 0)
      return t('empty')
    return null
  })()

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/40 p-3">
      {source === 'netease' && (
        <>
          <NeteaseSongSearch
            value={id}
            onSelect={(song) => {
              // 换歌后旧的歌词时间点不再适用，清空选择让作者重新选句
              setValues({ id: song.id, start: 0, end: 0, text: '' })
            }}
          />
          <div aria-hidden className="h-px bg-border" />
        </>
      )}
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <QuoteIcon className="size-4 text-primary" />
          <span className="text-sm font-medium">{t('title')}</span>
          <span className="ml-auto text-xs text-muted-foreground">{t('hint')}</span>
        </div>
        {lineHint
          ? (
              <p className={cn('rounded-md border border-dashed px-3 py-2 text-xs', fetchLyric && lyricState.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                {fetchLyric && lyricState.status === 'loading' && <Spinner className="mr-1.5 inline size-3" />}
                {lineHint}
              </p>
            )
          : (
              <>
                <ul className="grid max-h-64 gap-0.5 overflow-y-auto" aria-label={t('title')}>
                  {lines.map((line, index) => {
                    const isStart = hasSelection && line.startTime === start
                    const isEnd = end > 0 && line.startTime === end
                    const inRange = hasSelection && (isStart || (end > 0 && line.startTime > start && line.startTime <= end))
                    const translation = getExtraLyricLine(translationLines, line.startTime)?.originalText
                    const translatedText = translation && translation !== line.originalText ? translation : ''
                    const romaji = getExtraLyricLine(romajiLines, line.startTime)?.originalText
                    return (
                      <li key={`${line.startTime}-${index}`}>
                        <button
                          type="button"
                          aria-pressed={isStart}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            inRange && 'bg-primary/10',
                          )}
                          onClick={() => selectLine(line)}
                        >
                          <span className="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{formatTimestamp(line.startTime)}</span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className={cn('truncate', isStart || isEnd ? 'font-medium text-primary' : 'text-foreground/85')}>
                              {line.originalText || '—'}
                            </span>
                            {/* 外文歌词在选句时一并展示翻译/发音，方便作者确认引用内容 */}
                            {translatedText && (
                              <span className="truncate text-[11px] leading-4 text-muted-foreground">
                                {translatedText}
                              </span>
                            )}
                            {romaji && (
                              <span className="truncate text-[11px] leading-4 text-muted-foreground italic">
                                {romaji}
                              </span>
                            )}
                          </span>
                          {isStart && <span className="shrink-0 text-[11px] text-primary">{t('start')}</span>}
                          {isEnd && <span className="shrink-0 text-[11px] text-primary">{t('end')}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {hasSelection && (
                  <p className="text-xs text-muted-foreground">
                    {end > 0 ? t('range', { start: formatTimestamp(start), end: formatTimestamp(end) }) : t('selected', { time: formatTimestamp(start) })}
                  </p>
                )}
              </>
            )}
      </div>
    </div>
  )
}
