import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { useMusic } from '@/contexts/music-context'
import { cn } from '@/lib/utils'
import { getCurrentLyricIndex, getExtraLyricLine, getWordProgress } from '@/utils/music-lyric'

export default function LyricScroll() {
  const t = useTranslations('MusicPlayer')
  const {
    lyricLines,
    parsedLyricLines,
    translationLyricLines,
    romajiLyricLines,
    lyricSourceType,
    lyricMode,
    currentLyricIndex,
    currentTime,
    getAudio,
    seek,
    play,
  } = useMusic()
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const [smoothTime, setSmoothTime] = useState(0)

  useEffect(() => {
    let rafId = 0
    let lastRenderedMs = -1

    const tick = () => {
      const audio = getAudio()
      const nextTime = audio ? audio.currentTime * 1000 : (currentTime ?? 0) * 1000
      if (nextTime !== lastRenderedMs) {
        lastRenderedMs = nextTime
        setSmoothTime(nextTime)
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [currentTime, getAudio])

  const currentTimeMs = smoothTime || (currentTime ?? 0) * 1000
  const activeLyricIndex = getCurrentLyricIndex(parsedLyricLines, currentTimeMs, currentLyricIndex)

  useEffect(() => {
    if (!containerRef.current || activeLyricIndex == null || !lineRefs.current[activeLyricIndex])
      return

    const container = containerRef.current
    const target = lineRefs.current[activeLyricIndex]
    const targetOffset = (target?.offsetTop ?? 0) - container.clientHeight * 0.4 + (target?.clientHeight ?? 0) / 2

    container.scrollTo({ top: targetOffset, behavior: 'smooth' })
  }, [activeLyricIndex, parsedLyricLines.length])

  if (activeLyricIndex === null) {
    return null
  }

  const text = lyricLines[activeLyricIndex]?.text
  if (lyricLines.length === 1 && (text === 'pure_music_without_lyric' || text === 'no_lyric')) {
    return (
      <div className="py-4 text-center text-base text-slate-600 dark:text-slate-500">
        {t(text)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="max-h-40 overflow-y-auto overflow-x-hidden px-0 py-2 text-base leading-8 relative transition-colors max-w-full"
    >
      {parsedLyricLines.map((line, idx) => {
        const offset = idx - activeLyricIndex
        const isCurrent = idx === activeLyricIndex
        const isWordLyric = lyricSourceType === 'yrc' && line.items.some(item => item.duration > 0)
        const extraLyricLines = lyricMode === 'translation'
          ? translationLyricLines
          : lyricMode === 'romaji'
            ? romajiLyricLines
            : []
        const extraLine = extraLyricLines.length > 0
          ? getExtraLyricLine(extraLyricLines, line.startTime)
          : null
        const isTimedExtraLine = Boolean(extraLine?.items.some(item => item.duration > 0))

        return (
          <div
            key={line.startTime + line.originalText + idx}
            ref={(el) => { lineRefs.current[idx] = el }}
            className={cn(
              'select-none px-2 py-0 rounded text-center m-0 transition-all duration-500 ease-[cubic-bezier(.4,2,.6,1)] w-full font-bold cursor-pointer',
              isCurrent ? 'text-primary bg-primary/15' : 'text-slate-600 dark:text-slate-400',
            )}
            style={{
              filter: isCurrent ? 'drop-shadow(0 2px 8px #60a5fa44)' : undefined,
              fontSize: isCurrent ? '1.0rem' : '0.9rem',
              opacity: offset === 0 ? 1 : Math.max(0.4, 0.85 - Math.abs(offset) * 0.12),
              transform: `scale(${offset === 0 ? 1 : 0.95}) translateY(${offset > 0 ? 1 : offset < 0 ? -1 : 0}px)`,
              zIndex: offset === 0 ? 10 : 0,
            }}
            onClick={() => {
              seek(line.startTime / 1000)
              play()
            }}
          >
            {line.items.map((item, wordIdx) => {
              const wordText = item.text.replace(/\s+$/g, match => '\u00A0'.repeat(match.length))
              if (!isWordLyric || !isCurrent) {
                return (
                  <span key={wordIdx}>
                    {wordText}
                  </span>
                )
              }

              const itemEndTime = item.startTime + item.duration
              const isPast = currentTimeMs >= itemEndTime
              const isActive = currentTimeMs >= item.startTime && currentTimeMs < itemEndTime
              const progress = isPast ? 1 : isActive ? getWordProgress(item, currentTimeMs) : 0

              return (
                <span key={wordIdx} className="inline-block relative align-baseline">
                  <span className="select-none text-primary/40">{wordText}</span>
                  {progress > 0 && (
                    <span
                      className="absolute inset-0 select-none text-primary"
                      style={{
                        clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                        willChange: 'clip-path',
                        pointerEvents: 'none',
                      }}
                    >
                      {wordText}
                    </span>
                  )}
                </span>
              )
            })}
            {extraLine && (
              <div
                className={cn(
                  'mt-0.5 text-sm leading-5 font-medium transition-colors',
                  isCurrent ? 'text-primary/80' : 'text-slate-500 dark:text-slate-500',
                )}
              >
                {extraLine.items.map((item, itemIdx) => {
                  const itemText = item.text.replace(/\s+$/g, match => '\u00A0'.repeat(match.length))
                  if (!isTimedExtraLine || !isCurrent) {
                    return (
                      <span key={itemIdx}>
                        {itemText}
                      </span>
                    )
                  }

                  const itemEndTime = item.startTime + item.duration
                  const isPast = currentTimeMs >= itemEndTime
                  const isActive = currentTimeMs >= item.startTime && currentTimeMs < itemEndTime
                  const progress = isPast ? 1 : isActive ? getWordProgress(item, currentTimeMs) : 0

                  return (
                    <span key={itemIdx} className="inline-block relative align-baseline">
                      <span className="select-none text-primary/40">{itemText}</span>
                      {progress > 0 && (
                        <span
                          className="absolute inset-0 select-none text-primary/80"
                          style={{
                            clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                            willChange: 'clip-path',
                            pointerEvents: 'none',
                          }}
                        >
                          {itemText}
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
