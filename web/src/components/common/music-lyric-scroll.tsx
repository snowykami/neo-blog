import { useEffect, useRef } from 'react'
import { useMusic } from '@/contexts/music-context'

export default function LyricScroll() {
  const { lyricLines, currentLyricIndex } = useMusic()
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (
      containerRef.current
      && lineRefs.current[currentLyricIndex || 0]
      && lyricLines.length > 0
    ) {
      const container = containerRef.current
      const target = lineRefs.current[currentLyricIndex || 0]
      const containerHeight = container.clientHeight
      const targetOffset
        = (target?.offsetTop ?? 0)
          - containerHeight * 0.35
          + (target?.clientHeight ?? 0) / 2

      const start = container.scrollTop
      const change = targetOffset - start
      const duration = 500
      let startTime: number | null = null

      function animateScroll(timestamp: number) {
        if (!startTime)
          startTime = timestamp
        const elapsed = timestamp - startTime
        const progress = Math.min(elapsed / duration, 1)
        const ease
          = progress < 0.5
            ? 2 * progress * progress
            : -1 + (4 - 2 * progress) * progress
        container.scrollTop = start + change * ease
        if (progress < 1) {
          requestAnimationFrame(animateScroll)
        }
      }

      requestAnimationFrame(animateScroll)
    }
  }, [currentLyricIndex, lyricLines.length])

  if (currentLyricIndex === null) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`
        h-30 overflow-y-auto
        px-0 py-2
        text-base
        leading-8
        relative
        transition-colors
        max-w-full
      `}
    >
      {lyricLines.length === 0
        ? (
            <div className="text-center text-slate-600 dark:text-slate-500">
              No lyrics available
            </div>
          )
        : (
            lyricLines.map((line, idx) => {
              const offset = idx - currentLyricIndex
              let opacity = 1
              let scale = 1
              let translateY = 0
              let z = 10
              if (offset === 0) {
                opacity = 1
                scale = 1
                translateY = 0
                z = 10
              }
              else if (Math.abs(offset) === 1) {
                opacity = 0.8
                scale = 0.95
                translateY = offset > 0 ? 1 : -1
                z = 0
              }
              else if (Math.abs(offset) === 2) {
                opacity = 0.6
                scale = 0.95
                translateY = offset > 0 ? 1 : -1
                z = 0
              }
              else {
                opacity = 0.4
                scale = 0.95
                translateY = offset > 0 ? 1 : -1
                z = 0
              }
              const isCurrent = idx === currentLyricIndex
              return (
                <div
                  key={line.time + line.text + idx}
                  ref={(el) => { lineRefs.current[idx] = el }}
                  className={`
                    select-none px-2 py-0 rounded text-center m-0
                    transition-all duration-600 ease-[cubic-bezier(.4,2,.6,1)]
                    w-full font-bold
                    ${isCurrent ? 'text-primary bg-primary/15' : 'text-slate-600 dark:text-slate-400'}
                  `}
                  style={{
                    filter: isCurrent ? 'drop-shadow(0 2px 8px #60a5fa44)' : undefined,
                    fontSize: isCurrent ? '1.0rem' : '0.9rem',
                    opacity,
                    transform: `scale(${scale}) translateY(${translateY}px)`,
                    zIndex: z,
                  }}
                >
                  {line.text || '\u00A0'}
                </div>
              )
            })
          )}
    </div>
  )
}
