'use client'

import type { CardAudioStatus } from '../use-card-audio'
import type { LyricQuoteProps } from './schema'
import type { MusicLyricLine } from '@/utils/music-lyric'
import { QuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMusicSong } from '@/api/music'
import { useMusic, useMusicClock, useSongLyrics } from '@/contexts/music-context'
import { toSingleLineLyrics } from '@/lib/lyrics/from-platform'
import { cn } from '@/lib/utils'
import { songToTrack } from '@/models/music'
import { getExtraLyricLine, getWordProgress, isWordTimedLyricLine } from '@/utils/music-lyric'
import { MusicPlayButton, NeteaseOpenButton } from '../netease-song/music-controls'
import { useCachedRequest } from '../use-cached-request'
import { useCardAudio } from '../use-card-audio'
import { buildQuoteLyrics, getSnippetEndMs, resolveQuoteLines } from './quote-lines'

/** 把首尾空白替换为不换行空格：逐字歌词每个字渲染为 inline-block，普通空格会被折叠 */
function preserveEdgeSpaces(text: string) {
  return text.replace(/^\s+|\s+$/g, match => '\u00A0'.repeat(match.length))
}

// 片段播放开始后的一小段时间内不判断是否离开片段：播放器跳转到起始位置需要时间，期间读到的还是旧进度
const SNIPPET_ARM_DELAY_MS = 1500
// 进度越过片段结尾太多（读者自己拖动了进度）时视为离开片段，不再自动暂停
const SNIPPET_LEAVE_MS = 2000

/**
 * 片段播放：从摘录处开始播放，到摘录结尾自动暂停；只对通过摘录按钮开始的播放生效，
 * 读者在全站播放器中完整收听同一首歌时不打断
 */
function useSnippetStop(timeMs: number, active: boolean, endMs: number, stop: () => void) {
  const armedAtRef = useRef<number | null>(null)

  useEffect(() => {
    const armedAt = armedAtRef.current
    if (armedAt == null || !active || performance.now() - armedAt < SNIPPET_ARM_DELAY_MS)
      return
    if (timeMs >= endMs + SNIPPET_LEAVE_MS) {
      armedAtRef.current = null
      return
    }
    if (timeMs >= endMs) {
      armedAtRef.current = null
      stop()
    }
  }, [active, endMs, stop, timeMs])

  return {
    arm: () => {
      armedAtRef.current = performance.now()
    },
    disarm: () => {
      armedAtRef.current = null
    },
  }
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
  // 与快照文本对齐的歌词行；为 null 时只展示快照文本（fallbackText）
  lines: MusicLyricLine[] | null
  translationLines: MusicLyricLine[]
  romajiLines: MusicLyricLine[]
  showTranslation: boolean
  showRomaji: boolean
  fallbackText: string
  title?: string
  artists?: string[]
  href?: string
  loading?: boolean
  // 片段正在播放：用于按行区分已唱 / 当前 / 未唱
  playing: boolean
  // 播放按钮的状态；为 null 时不能在站内播放（显示网易云链接）
  status: CardAudioStatus | null
  getTime: () => number | null
  onToggle: () => void
}

/** 歌词摘录的展示部分：引用样式 + 单句/多句歌词 + 翻译/发音 + 旁边的播放按钮 */
function LyricQuoteView({ lines, translationLines, romajiLines, showTranslation, showRomaji, fallbackText, title, artists, href, loading, playing, status, getTime, onToggle }: LyricQuoteViewProps) {
  const t = useTranslations('ContentComponents.lyricQuote')
  const songT = useTranslations('ContentComponents.neteaseSong')
  const quoteLines = lines && lines.length > 0 ? lines : null
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

  const action = status
    ? <MusicPlayButton status={status} onClick={onToggle} />
    : href && <NeteaseOpenButton href={href} />

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
                // 快照文本中多句以换行分隔，保留换行
                <span className={cn('block whitespace-pre-line', loading && !fallbackText && 'text-muted-foreground')}>
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
        {status === 'error' && <p className="text-xs text-destructive">{songT('audio_error')}</p>}
      </div>
      {action && <div className="self-center">{action}</div>}
    </figure>
  )
}

/** 歌词摘录：把一句（或一段）歌词引用到文章中，点击播放从该句开始播放，到摘录结尾自动暂停 */
export default function LyricQuote(props: LyricQuoteProps) {
  return props.source === 'custom' ? <CustomLyricQuote {...props} /> : <NeteaseLyricQuote {...props} />
}

function NeteaseLyricQuote({ id, lyric: authorLyric, translation, romaji, showTranslation, showRomaji, start, end, text, title, artist }: LyricQuoteProps) {
  const { playlist, currentTrack, isPlaying, playTrack, playSong, pause, getAudio } = useMusic()
  const index = playlist.findIndex(track => track.id === id)
  const track = index >= 0 ? playlist[index] : null
  const songState = useCachedRequest(track ? null : `ncm-song:${id}`, () => getMusicSong(id))
  const fetched = !track && songState.status === 'success' ? songState.data : null
  const song = track ?? fetched
  // 不在歌单内的歌曲由后端判断能否在站内播放（公开文章引用的歌曲、登录的管理员与编辑），可以时插到当前曲目之后播放
  const playable = track != null || !!fetched?.playable
  // 作者未填写原歌词，或需要在线补全已开启显示的翻译/发音时才取在线歌词
  const needsTranslation = showTranslation && !translation.trim()
  const needsRomaji = showRomaji && !romaji.trim()
  const needsFetchedLyric = id > 0 && (!authorLyric.trim() || needsTranslation || needsRomaji)
  // 在线歌词与播放器、导航栏共用同一份来源与选择结果
  const songLyrics = useSongLyrics(needsFetchedLyric ? id : null, song)
  const online = useMemo(() => (songLyrics.status === 'ready' ? toSingleLineLyrics(songLyrics.lyrics) : null), [songLyrics])
  const { lines, translationLines, romajiLines } = useMemo(
    () => buildQuoteLyrics({ online, authorLyric, translation, romaji }),
    [authorLyric, online, romaji, translation],
  )
  const quoteLines = useMemo(() => resolveQuoteLines(lines, start, end, text), [lines, start, end, text])
  const playFromMs = quoteLines?.[0]?.startTime ?? start
  const endMs = getSnippetEndMs(lines, quoteLines ?? [], start, end)
  const isCurrent = track != null && currentTrack?.id === id
  // 只有摘录的歌曲正在全站播放器中时才订阅播放进度
  const timeMs = useMusicClock(isCurrent) * 1000
  // 正在播放这首歌且进度落在摘录范围内时，摘录处于播放状态（按行高亮）
  const playing = isCurrent && isPlaying && timeMs >= playFromMs - 250 && timeMs < endMs + 500
  const getTime = useCallback(() => getAudio()?.currentTime ?? null, [getAudio])
  const snippet = useSnippetStop(timeMs, isCurrent && isPlaying, endMs, pause)

  const href = song?.link || `https://music.163.com/#/song?id=${id}`
  const loading = !song && songState.status === 'loading'
  const onToggle = () => {
    if (!playable)
      return
    if (playing) {
      snippet.disarm()
      pause()
      return
    }
    snippet.arm()
    if (track)
      playTrack(index, playFromMs / 1000)
    else if (fetched)
      playSong(songToTrack(fetched), playFromMs / 1000)
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
      loading={loading || (!authorLyric.trim() && songLyrics.status === 'loading')}
      playing={playing}
      status={playable ? (playing ? 'playing' : 'idle') : null}
      getTime={getTime}
      onToggle={onToggle}
    />
  )
}

function CustomLyricQuote({ title, artist, src, lyric, translation, romaji, showTranslation, showRomaji, start, end, text }: LyricQuoteProps) {
  const audio = useCardAudio(src)

  const { lines, translationLines, romajiLines } = useMemo(
    () => buildQuoteLyrics({ online: null, authorLyric: lyric, translation, romaji }),
    [lyric, romaji, translation],
  )
  const quoteLines = useMemo(() => resolveQuoteLines(lines, start, end, text), [lines, start, end, text])
  const playFromMs = quoteLines?.[0]?.startTime ?? start
  const endMs = getSnippetEndMs(lines, quoteLines ?? [], start, end)
  const snippet = useSnippetStop(audio.currentTime * 1000, audio.playing, endMs, audio.pause)

  const onToggle = () => {
    if (audio.playing) {
      snippet.disarm()
      audio.pause()
      return
    }
    // 每次都从摘录处开始播放
    snippet.arm()
    audio.play(playFromMs / 1000)
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
      playing={audio.playing}
      status={audio.status}
      getTime={audio.getTime}
      onToggle={onToggle}
    />
  )
}
