'use client'

import type { ContentEditorActionProps } from '../types'
import type { LyricQuoteInput } from './schema'
import type { LyricLine } from '@/lib/lyrics/types'
import { QuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { useResolvedSongLyrics as useSongLyrics } from '@/contexts/song-lyrics'
import { getLyricLineText, getLyricLineVocalStart } from '@/lib/lyrics/line-utils'
import { cn } from '@/lib/utils'
import { NeteaseSongSearch } from '../netease-song/netease-song-search'
import { buildQuoteLyrics } from './quote-lines'

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
  // 网易云模式：作者未填写歌词且已选择歌曲时，取在线歌词用于选句（与文章内展示、播放器同一来源与选择结果）
  const fetchLyric = source === 'netease' && id > 0 && !authorLyric
  const songLyrics = useSongLyrics(fetchLyric ? id : null)
  const online = songLyrics.status === 'ready' ? songLyrics.lyrics : null
  const { lines } = useMemo(
    () => buildQuoteLyrics({ online, authorLyric, translation: authorTranslation, romaji: authorRomaji }),
    [authorLyric, authorRomaji, authorTranslation, online],
  )

  const start = toMs(values.start)
  const end = toMs(values.end)
  // 第一句可能正好在 0 毫秒，用歌词文本快照判断是否已经选择过
  const hasSelection = start > 0 || Boolean(values.text?.trim())

  const selectLine = (line: LyricLine) => {
    const lineStart = getLyricLineVocalStart(line)
    const lineText = getLyricLineText(line).trim()
    // 没有选择，或已经选完一段时，点击都表示重新选择起始句
    if (!hasSelection || end > 0) {
      setValues({ start: lineStart, end: 0, text: lineText })
      return
    }

    // 已选起始句：后面的句子作为结束句
    if (lineStart > start) {
      const startIndex = lines.findIndex(item => getLyricLineVocalStart(item) === start)
      const endIndex = lines.findIndex(item => getLyricLineVocalStart(item) === lineStart)
      const selectedText = startIndex >= 0 && endIndex >= startIndex
        ? lines.slice(startIndex, endIndex + 1).map(item => getLyricLineText(item).trim()).join('\n')
        : lineText
      setValues({ end: lineStart, text: selectedText })
      return
    }

    // 第二次点在更早的句子上：把它作为新的起始句
    setValues({ start: lineStart, end: 0, text: lineText })
  }

  // 歌词列表的占位提示：优先说明缺少的前置条件，再显示加载 / 失败状态
  const lineHint = (() => {
    if (source === 'custom' && !authorLyric)
      return t('need_lyric')
    if (fetchLyric && songLyrics.status === 'loading')
      return t('loading')
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
              <p className={cn('rounded-md border border-dashed px-3 py-2 text-xs', 'text-muted-foreground')}>
                {fetchLyric && songLyrics.status === 'loading' && <Spinner className="mr-1.5 inline size-3" />}
                {lineHint}
              </p>
            )
          : (
              <>
                <ul className="grid max-h-64 gap-0.5 overflow-y-auto" aria-label={t('title')}>
                  {lines.map((line, index) => {
                    const lineStart = getLyricLineVocalStart(line)
                    const lineText = getLyricLineText(line).trim()
                    const isStart = hasSelection && lineStart === start
                    const isEnd = end > 0 && lineStart === end
                    const inRange = hasSelection && (isStart || (end > 0 && lineStart > start && lineStart <= end))
                    const translatedText = line.translation && line.translation !== lineText ? line.translation : ''
                    const romaji = line.romanization ?? ''
                    return (
                      <li key={`${lineStart}-${index}`}>
                        <button
                          type="button"
                          aria-pressed={isStart}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            inRange && 'bg-primary/10',
                          )}
                          onClick={() => selectLine(line)}
                        >
                          <span className="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{formatTimestamp(lineStart)}</span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className={cn('truncate', isStart || isEnd ? 'font-medium text-primary' : 'text-foreground/85')}>
                              {lineText || '—'}
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
