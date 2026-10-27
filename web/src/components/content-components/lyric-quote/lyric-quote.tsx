'use client'

import type { LyricQuoteProps } from './schema'
import type { MusicLyrics } from '@/api/music'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { ExternalLinkIcon, PauseIcon, PlayIcon, QuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchNcmLyric, getMusicSong } from '@/api/music'
import { Button } from '@/components/ui/button'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { getExtraLyricLine, getWordProgress, isWordTimedLyricLine, LYRIC_PLACEHOLDERS, parseMusicLyrics } from '@/utils/music-lyric'
import { claimActiveAudio, releaseActiveAudio } from '../active-audio'
import { useCachedRequest } from '../use-cached-request'

/** 把首尾空白替换为不换行空格：逐字歌词每个字渲染为 inline-block，普通空格会被折叠 */
function preserveEdgeSpaces(text: string) {
  return text.replace(/^\s+|\s+$/g, match => '\u00A0'.repeat(match.length))
}

/**
 * 取引用范围内的歌词行：start 为起始句的开始时间（毫秒），end 为结束句（0 表示只引用起始句）；
 * 找不到完全一致的时间时取最后一个已开始的行，便于作者手填时间
 */
function getQuoteLines(lines: MusicLyricLine[], start: number, end: number): MusicLyricLine[] {
  if (lines.length === 0)
    return []

  const findIndex = (time: number, exact = true) => {
    const found = lines.findIndex(line => Math.abs(line.startTime - time) <= 350)
    if (found >= 0 || exact)
      return found
    let index = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startTime <= time)
        index = i
    }
    return index
  }

  let startIndex = findIndex(start)
  if (startIndex < 0)
    startIndex = findIndex(start, false)
  const endIndex = end > 0 ? Math.max(startIndex, findIndex(end, false)) : startIndex
  return lines.slice(startIndex, endIndex + 1)
}

function getQuoteEndMs(lines: MusicLyricLine[], quoteLines: MusicLyricLine[]): number {
  const lastLine = quoteLines[quoteLines.length - 1]
  if (!lastLine)
    return 0
  if (lastLine.duration > 0)
    return lastLine.startTime + lastLine.duration
  const index = lines.indexOf(lastLine)
  const nextLine = index >= 0 ? lines[index + 1] : undefined
  return nextLine?.startTime ?? lastLine.startTime + 5000
}

/** 过滤歌词接口返回的占位文本，避免把 no_lyric 当作翻译/发音展示 */
function cleanLyricLines(lines: MusicLyricLine[]): MusicLyricLine[] {
  return lines.filter(line => !LYRIC_PLACEHOLDERS.has(line.originalText.trim()))
}

/** 引用范围内的一行歌词：播放时按行区分已唱/当前/未唱，逐字歌词在已唱和当前行显示擦除高亮 */
type LyricLineState = 'idle' | 'played' | 'current' | 'unplayed'

function QuoteLyricLine({ line, playing, state, getTime }: { line: MusicLyricLine, playing: boolean, state: LyricLineState, getTime: () => number | null }) {
  const wordTimed = isWordTimedLyricLine(line)
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!playing || !wordTimed)
      return
    let rafId = 0
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const seconds = getTime()
      if (seconds == null)
        return
      const timeMs = seconds * 1000
      line.items.forEach((item, index) => {
        const fill = fillRefs.current[index]
        if (!fill)
          return
        const progress = getWordProgress(item, timeMs)
        const clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
        if (fill.style.clipPath !== clipPath)
          fill.style.clipPath = clipPath
      })
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [getTime, line, playing, wordTimed])

  if (!playing || !wordTimed)
    return <>{line.originalText}</>

  const fillClass = state === 'played' ? 'text-primary/70' : 'text-primary'

  return (
    <span className="whitespace-pre">
      {line.items.map((word, index) => (
        <span
          key={`${word.startTime}-${word.duration}-${index}`}
          className="relative inline-block align-baseline"
        >
          <span className="select-none text-primary/40">{preserveEdgeSpaces(word.text)}</span>
          <span
            ref={(el) => { fillRefs.current[index] = el }}
            aria-hidden
            className={cn('pointer-events-none absolute inset-0 select-none', fillClass)}
            style={{ clipPath: 'inset(0 100% 0 0)' }}
          >
            {preserveEdgeSpaces(word.text)}
          </span>
        </span>
      ))}
    </span>
  )
}

interface LyricQuoteViewProps {
  lines: MusicLyricLine[]
  translationLines: MusicLyricLine[]
  romajiLines: MusicLyricLine[]
  showTranslation: boolean
  showRomaji: boolean
  fallbackText: string
  title?: string
  artists?: string[]
  href?: string
  loading?: boolean
  playing: boolean
  playable: boolean
  getTime: () => number | null
  onToggle: () => void
}

/** 歌词摘录的展示部分：引用样式 + 单句/多句歌词 + 翻译/发音 + 旁边的播放按钮 */
function LyricQuoteView({ lines, translationLines, romajiLines, showTranslation, showRomaji, fallbackText, title, artists, href, loading, playing, playable, getTime, onToggle }: LyricQuoteViewProps) {
  const t = useTranslations('ContentComponents.lyricQuote')
  // 没有解析到歌词时，使用作者选择时保存的文本快照
  const quoteLines = lines.length > 0 ? lines : null
  const caption = [title, artists?.filter(Boolean).join(' / ')].filter(Boolean).join(' · ')
  // 只在跨过歌词行时更新，避免播放期间每帧触发 React 重渲染
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!playing || !quoteLines) {
      setActiveLineIndex(null)
      return
    }

    let rafId = 0
    let lastIndex: number | null = null
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const seconds = getTime()
      if (seconds == null)
        return

      const timeMs = seconds * 1000
      let index = -1
      for (let i = 0; i < quoteLines.length; i++) {
        if (quoteLines[i].startTime > timeMs)
          break
        index = i
      }
      if (index !== lastIndex) {
        lastIndex = index
        setActiveLineIndex(index)
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [getTime, playing, quoteLines])

  const action = playable
    ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label={t(playing ? 'pause' : 'play')}
          title={t(playing ? 'pause' : 'play')}
          onClick={onToggle}
        >
          {playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
        </Button>
      )
    : href
      ? (
          <Button asChild variant="outline" size="icon" className="size-9 shrink-0 rounded-full">
            <a href={href} target="_blank" rel="noopener noreferrer" title={t('not_in_playlist')} aria-label={t('not_in_playlist')}>
              <ExternalLinkIcon />
            </a>
          </Button>
        )
      : null

  return (
    <figure className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3.5">
      <QuoteIcon aria-hidden className="mt-1 size-4 shrink-0 text-primary/50" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <blockquote className="text-[15px] font-medium leading-7 text-primary">
          {quoteLines
            ? quoteLines.map((line, index) => {
                const translation = showTranslation
                  ? getExtraLyricLine(translationLines, line.startTime)?.originalText
                  : ''
                const romaji = showRomaji
                  ? getExtraLyricLine(romajiLines, line.startTime)?.originalText
                  : ''
                // 有些歌曲的「翻译」与原文相同，避免重复展示
                const translatedText = translation && translation !== line.originalText ? translation : ''
                const lineState: LyricLineState = activeLineIndex == null
                  ? 'idle'
                  : index < activeLineIndex
                    ? 'played'
                    : index === activeLineIndex
                      ? 'current'
                      : 'unplayed'
                return (
                  <span
                    key={`${line.startTime}-${index}`}
                    className={cn(
                      'block transition-colors',
                      lineState === 'unplayed' && 'text-primary/40',
                      lineState === 'played' && 'text-primary/70',
                      lineState === 'current' && 'text-primary',
                    )}
                  >
                    <QuoteLyricLine line={line} playing={playing} state={lineState} getTime={getTime} />
                    {(translatedText || romaji) && (
                      <span className="mt-0.5 grid gap-0.5 text-xs font-normal leading-5 text-muted-foreground">
                        {translatedText && <span className="block">{translatedText}</span>}
                        {romaji && <span className="block italic">{romaji}</span>}
                      </span>
                    )}
                  </span>
                )
              })
            : (
                <span className={cn('block', loading && 'text-muted-foreground')}>
                  {fallbackText || t(loading ? 'loading_lyric' : 'no_lyric')}
                </span>
              )}
        </blockquote>
        {caption && (
          <figcaption className="truncate text-xs text-muted-foreground">
            {href
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground no-underline hover:text-primary">{caption}</a>
              : caption}
          </figcaption>
        )}
      </div>
      {action && <div className="self-center">{action}</div>}
    </figure>
  )
}

/** 歌词摘录：把一句（或一段）歌词引用到文章中，点击播放从该句开始播放 */
export default function LyricQuote(props: LyricQuoteProps) {
  return props.source === 'custom' ? <CustomLyricQuote {...props} /> : <NeteaseLyricQuote {...props} />
}

function NeteaseLyricQuote({ id, lyric: authorLyric, translation, romaji, showTranslation, showRomaji, start, end, text, title, artist }: LyricQuoteProps) {
  const { playlist, currentTrack, isPlaying, currentTime, playTrack, togglePlay, getAudio } = useMusic()
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  const songState = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  // 作者未填写原歌词，或需要在线补全已开启显示的翻译/发音时才请求歌词
  const needsTranslation = showTranslation && !translation.trim()
  const needsRomaji = showRomaji && !romaji.trim()
  const needsFetchedLyric = id > 0 && (!authorLyric.trim() || needsTranslation || needsRomaji)
  const lyricState = useCachedRequest(needsFetchedLyric ? `ncm-lyric:${id}` : null, () => fetchNcmLyric(id))

  const parsed = useMemo(() => {
    try {
      const fetched = lyricState.status === 'success' ? lyricState.data : null
      let raw: MusicLyrics | null = fetched
      // 作者手填原歌词时优先使用手填版本，同时保留网易云的翻译/发音
      if (authorLyric.trim()) {
        raw = {
          ...(fetched ?? {}),
          lrc: { lyric: authorLyric, version: 1 },
          yrc: null,
        }
      }
      // 作者手填翻译/发音时覆盖在线数据
      if (translation.trim()) {
        raw = {
          ...(raw ?? {}),
          tlyric: { lyric: translation, version: 1 },
          ytlrc: null,
        }
      }
      if (romaji.trim()) {
        raw = {
          ...(raw ?? {}),
          romalrc: { lyric: romaji, version: 1 },
          yromalrc: null,
        }
      }
      return raw ? parseMusicLyrics(raw) : null
    }
    catch {
      return null
    }
  }, [authorLyric, lyricState, romaji, translation])

  const lines = useMemo(() => cleanLyricLines(parsed?.lines ?? []), [parsed])
  const translationLines = useMemo(() => cleanLyricLines(parsed?.translationLines ?? []), [parsed])
  const romajiLines = useMemo(() => cleanLyricLines(parsed?.romajiLines ?? []), [parsed])
  const quoteLines = useMemo(() => getQuoteLines(lines, start, end), [lines, start, end])
  const playFromMs = quoteLines[0]?.startTime ?? start
  const quoteEndMs = getQuoteEndMs(lines, quoteLines)
  // 只有文本快照、没有可解析歌词时，按 5 秒估算引用范围，保证播放按钮仍能切换状态
  const activeEndMs = quoteEndMs > playFromMs ? quoteEndMs : playFromMs + 5000
  const isCurrent = track != null && currentTrack?.id === id
  const timeMs = (currentTime ?? 0) * 1000
  // 只有正在播放当前歌曲且进度落在引用范围内时才显示逐字高亮
  const playing = isCurrent && isPlaying && timeMs >= playFromMs - 250 && timeMs < activeEndMs + 500
  const getTime = useCallback(() => getAudio()?.currentTime ?? null, [getAudio])

  const song = track ?? (songState.status === 'success' ? songState.data : null)
  const href = song?.link || `https://music.163.com/#/song?id=${id}`
  const loading = !song && songState.status === 'loading'
  const onToggle = () => {
    if (!track)
      return
    if (playing) {
      togglePlay()
      return
    }
    playTrack(index, playFromMs / 1000)
  }

  return (
    <LyricQuoteView
      lines={quoteLines}
      translationLines={translationLines}
      romajiLines={romajiLines}
      showTranslation={showTranslation}
      showRomaji={showRomaji}
      fallbackText={text}
      title={song?.name || title}
      artists={song?.artists ?? (artist ? [artist] : [])}
      href={href}
      loading={loading || (!authorLyric.trim() && lyricState.status === 'loading')}
      playing={playing}
      playable={track != null}
      getTime={getTime}
      onToggle={onToggle}
    />
  )
}

function CustomLyricQuote({ title, artist, src, lyric, translation, romaji, showTranslation, showRomaji, start, end, text }: LyricQuoteProps) {
  const { isPlaying: globalPlaying, pause: pauseGlobal } = useMusic()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = src
    audioRef.current = audio
    const onPlay = () => {
      claimActiveAudio(audio)
      setPlaying(true)
    }
    const onPause = () => setPlaying(false)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    return () => {
      audio.pause()
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
      releaseActiveAudio(audio)
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
      setPlaying(false)
    }
  }, [src])

  // 全站播放器开始播放时暂停当前摘录
  useEffect(() => {
    if (globalPlaying)
      audioRef.current?.pause()
  }, [globalPlaying])

  const parsed = useMemo(() => {
    try {
      if (!lyric.trim())
        return null
      const raw: MusicLyrics = { lrc: { lyric, version: 1 } }
      if (translation.trim())
        raw.tlyric = { lyric: translation, version: 1 }
      if (romaji.trim())
        raw.romalrc = { lyric: romaji, version: 1 }
      return parseMusicLyrics(raw)
    }
    catch {
      return null
    }
  }, [lyric, romaji, translation])

  const lines = useMemo(() => cleanLyricLines(parsed?.lines ?? []), [parsed])
  const translationLines = useMemo(() => cleanLyricLines(parsed?.translationLines ?? []), [parsed])
  const romajiLines = useMemo(() => cleanLyricLines(parsed?.romajiLines ?? []), [parsed])
  const quoteLines = useMemo(() => getQuoteLines(lines, start, end), [lines, start, end])
  const playFromMs = quoteLines[0]?.startTime ?? start
  const getTime = useCallback(() => audioRef.current?.currentTime ?? null, [])

  const onToggle = () => {
    const audio = audioRef.current
    if (!audio)
      return
    if (!audio.paused) {
      audio.pause()
      return
    }
    pauseGlobal()
    try {
      audio.currentTime = playFromMs / 1000
    }
    catch { }
    void audio.play().catch(() => {
      // 浏览器阻止播放或音频无法加载时保持暂停状态
    })
  }

  return (
    <LyricQuoteView
      lines={quoteLines}
      translationLines={translationLines}
      romajiLines={romajiLines}
      showTranslation={showTranslation}
      showRomaji={showRomaji}
      fallbackText={text}
      title={title}
      artists={artist ? [artist] : []}
      playing={playing}
      playable
      getTime={getTime}
      onToggle={onToggle}
    />
  )
}
