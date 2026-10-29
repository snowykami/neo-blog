'use client'

import type { NavWordStyle } from '@/lib/lyrics/nav-emphasis'
import type { LyricMarqueeWordBox, MusicLyricLine } from '@/utils/music-lyric'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useCurrentLyricIndex, useMusic } from '@/contexts/music-context'
import { navEmphasisStyle } from '@/lib/lyrics/nav-emphasis'
import { cn } from '@/lib/utils'
import { getCurrentLyricIndex, getLyricMarqueeOffset, getWordProgress, isWordTimedLyricLine } from '@/utils/music-lyric'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(reducedMotionQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  )
}

// 逐帧更新的最短间隔：高刷新率屏幕（120Hz）上也只按约 60fps 更新，逐字擦除看起来一样平滑，工作量减半
const MIN_FRAME_MS = 1000 / 60 - 1

// 导航栏歌词两侧渐隐遮罩：仅在内容溢出时启用，滚动到头/尾时去掉对应一侧
const NAV_LYRIC_FADE = '1.25em'
function getNavLyricMask(fadeStart: boolean, fadeEnd: boolean) {
  if (!fadeStart && !fadeEnd)
    return ''
  return `linear-gradient(to right, ${fadeStart ? 'transparent' : 'black'}, black ${NAV_LYRIC_FADE}, black calc(100% - ${NAV_LYRIC_FADE}), ${fadeEnd ? 'transparent' : 'black'})`
}

interface NavLyricLayout {
  lineKey: string
  containerWidth: number
  contentWidth: number
  wordBoxes: LyricMarqueeWordBox[]
  words: HTMLElement[]
  fills: HTMLElement[]
}

/**
 * 当前一行歌词（导航栏、文章内单曲卡共用）：当前行超出容器宽度时水平滚动
 * - 逐行歌词：先停留约 10%，再匀速滚动，在约 88% 行时长处露出结尾
 * - 逐字歌词：跟随当前演唱位置滚动，使其保持在可视区域约 65% 处；开启歌词特效时沿用播放器的强调分组（含歌词标注），
 *   做简化的特效（放大、辉光、上浮、抖动与长音颤音、由虚到实、心跳、流光、消散、上色与粗体 / 斜体，见 lib/lyrics/nav-emphasis.ts）
 * 偏移量、逐字高亮与特效均在 requestAnimationFrame 中直接写 DOM，不触发逐帧 React 渲染；最多约 60fps，滚出视野或被隐藏时不更新
 */
export function LyricLine() {
  const t = useTranslations('MusicPlayer')
  const { lyricLines, lyrics, getAudio, showLyricEffects } = useMusic()
  // 与 lyricLines 一一对应的强调分组（lyricLines 为 lyrics 中的主唱行）；关闭歌词特效或不是逐字歌词时为 null
  const emphasisLines = useMemo(
    () => showLyricEffects && lyrics.wordTimed ? lyrics.lines.filter(line => !line.isBackground).map(line => line.emphasis ?? []) : null,
    [lyrics, showLyricEffects],
  )
  const currentLyricIndex = useCurrentLyricIndex()
  const prefersReducedMotion = usePrefersReducedMotion()
  const containerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const layoutRef = useRef<NavLyricLayout | null>(null)
  // 是否在可视区域内：滚出视野的单曲卡、被隐藏的导航栏不做逐帧计算与 DOM 写入
  const visibleRef = useRef(true)
  // rAF 中计算出的行索引，与所属歌词数组绑定，避免切歌后沿用旧索引
  const [rafActive, setRafActive] = useState<{ lines: MusicLyricLine[], index: number | null } | null>(null)
  const activeLyricIndex = rafActive?.lines === lyricLines ? rafActive.index : currentLyricIndex
  const line = activeLyricIndex == null ? undefined : lyricLines[activeLyricIndex]
  const isWordLyric = Boolean(line && isWordTimedLyricLine(line))
  const lineKey = line ? `${activeLyricIndex}-${line.startTime}` : ''

  // 容器或内容尺寸变化（窗口缩放、字体加载）时使布局缓存失效，下一帧重新测量
  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(() => {
      layoutRef.current = null
    })
    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [lineKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined')
      return
    const observer = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [lineKey])

  useEffect(() => {
    if (lyricLines.length === 0)
      return
    let rafId = 0
    let lastFrameAt = 0
    let lastIndex: number | null | undefined
    // 跳转检测（同歌词引擎）：进度与按经过时间推算的进度相差超过 1 秒视为拖动了进度，记下落点（消散特效在落点之前的不消散）
    let lastTime: { timeMs: number, at: number } | null = null
    let seekAt = Number.NEGATIVE_INFINITY
    let lastTransform = ''
    let lastMask: string | null = null
    const fillProgress = new WeakMap<HTMLElement, number>()
    const wordStyles = new WeakMap<HTMLElement, NavWordStyle>()

    const measure = (content: HTMLElement, container: HTMLElement, key: string): NavLyricLayout => {
      const words = Array.from(content.querySelectorAll<HTMLElement>('[data-word-index]'))
      return {
        lineKey: key,
        containerWidth: container.clientWidth,
        contentWidth: content.scrollWidth,
        // offsetLeft 不受 transform 影响，内容元素为 relative 定位，作为各字的 offsetParent
        wordBoxes: words.map(word => ({ left: word.offsetLeft, width: word.offsetWidth })),
        words,
        fills: words.map(word => word.querySelector<HTMLElement>('[data-word-fill]')).filter((fill): fill is HTMLElement => Boolean(fill)),
      }
    }

    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const now = performance.now()
      // 不可见时跳过；限制到约 60fps
      if (!visibleRef.current || now - lastFrameAt < MIN_FRAME_MS)
        return
      lastFrameAt = now
      const audio = getAudio()
      if (!audio)
        return
      const timeMs = audio.currentTime * 1000
      if (!lastTime || Math.abs(timeMs - (lastTime.timeMs + (audio.paused ? 0 : now - lastTime.at))) > 1000)
        seekAt = timeMs
      lastTime = { timeMs, at: now }
      const index = getCurrentLyricIndex(lyricLines, timeMs, null)
      if (index !== lastIndex) {
        lastIndex = index
        setRafActive({ lines: lyricLines, index })
      }

      const container = containerRef.current
      const content = contentRef.current
      const current = index == null ? undefined : lyricLines[index]
      if (!container || !content || !current)
        return
      // React 尚未渲染出新行时跳过，避免把旧行的测量结果用于新行
      const key = `${index}-${current.startTime}`
      if (content.dataset.lineKey !== key)
        return

      let layout = layoutRef.current
      if (!layout || layout.lineKey !== key) {
        layout = measure(content, container, key)
        layoutRef.current = layout
        lastTransform = ''
        lastMask = null
      }

      // 逐字高亮
      if (isWordTimedLyricLine(current)) {
        current.items.forEach((item, wordIndex) => {
          const fill = layout.fills[wordIndex]
          if (!fill)
            return
          const progress = getWordProgress(item, timeMs)
          if (fillProgress.get(fill) === progress)
            return
          fillProgress.set(fill, progress)
          fill.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`
        })
        // 强调特效：样式写在词上，颜色写在已唱部分上；未变化时不重复写 DOM
        for (const group of (index == null ? null : emphasisLines?.[index]) ?? []) {
          for (let wordIndex = group.from; wordIndex < group.to; wordIndex++) {
            const word = layout.words[wordIndex]
            const fill = layout.fills[wordIndex]
            if (!word || !fill)
              continue
            const style = navEmphasisStyle(group, wordIndex - group.from, group.to - group.from, timeMs, !prefersReducedMotion, seekAt)
            const last = wordStyles.get(word)
            if (last?.transform !== style.transform)
              word.style.transform = style.transform
            if (last?.textShadow !== style.textShadow)
              word.style.textShadow = style.textShadow
            if (last?.filter !== style.filter)
              word.style.filter = style.filter
            if (last?.opacity !== style.opacity)
              word.style.opacity = style.opacity
            if (last?.color !== style.color)
              fill.style.color = style.color
            wordStyles.set(word, style)
          }
        }
      }

      // 减少动态效果时不滚动，仅显示开头并以省略号截断
      if (prefersReducedMotion)
        return

      const overflow = layout.contentWidth - layout.containerWidth
      const offset = getLyricMarqueeOffset({
        line: current,
        nextLineStartTime: index == null ? undefined : lyricLines[index + 1]?.startTime,
        currentTimeMs: timeMs,
        containerWidth: layout.containerWidth,
        contentWidth: layout.contentWidth,
        wordBoxes: isWordTimedLyricLine(current) ? layout.wordBoxes : undefined,
      })
      const transform = offset > 0 ? `translate3d(${-offset.toFixed(2)}px, 0, 0)` : ''
      if (transform !== lastTransform) {
        lastTransform = transform
        content.style.transform = transform
      }
      const mask = overflow > 0 ? getNavLyricMask(offset > 0.5, offset < overflow - 0.5) : ''
      if (mask !== lastMask) {
        lastMask = mask
        container.style.maskImage = mask
        container.style.webkitMaskImage = mask
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [emphasisLines, getAudio, lyricLines, prefersReducedMotion])

  // 切换减少动态效果时清理已写入的位移与遮罩
  useEffect(() => {
    layoutRef.current = null
    if (!prefersReducedMotion)
      return
    if (contentRef.current)
      contentRef.current.style.transform = ''
    if (containerRef.current) {
      containerRef.current.style.maskImage = ''
      containerRef.current.style.webkitMaskImage = ''
    }
  }, [prefersReducedMotion])

  if (!line)
    return lyrics.instrumental ? t('pure_music_without_lyric') : ''
  // 粗体 / 斜体的词（来自歌词标注）
  const styledWords = new Map<number, string>()
  for (const group of (activeLyricIndex == null ? null : emphasisLines?.[activeLyricIndex]) ?? []) {
    const className = cn(group.styles?.includes('bold') && 'font-bold', group.styles?.includes('italic') && 'italic')
    if (!className)
      continue
    for (let wordIndex = group.from; wordIndex < group.to; wordIndex++)
      styledWords.set(wordIndex, className)
  }

  return (
    <span
      ref={containerRef}
      className={cn('block max-w-full overflow-hidden whitespace-pre', prefersReducedMotion && 'text-ellipsis')}
    >
      <span
        // key 保证换行时重新挂载，旧行的位移与高亮不会残留到新行
        key={lineKey}
        ref={contentRef}
        data-line-key={lineKey}
        className={cn('relative text-primary', prefersReducedMotion ? 'inline' : 'inline-block')}
      >
        {isWordLyric
          ? line.items.map((word, index) => (
              <span
                key={`${word.startTime}-${word.duration}-${index}`}
                data-word-index={index}
                className={cn('relative inline-block align-baseline', styledWords.get(index))}
              >
                <span className="select-none text-primary/45">{word.text}</span>
                <span
                  data-word-fill
                  aria-hidden
                  className="pointer-events-none absolute inset-0 select-none text-primary"
                  style={{ clipPath: 'inset(0 100% 0 0)' }}
                >
                  {word.text}
                </span>
              </span>
            ))
          : line.originalText}
      </span>
    </span>
  )
}
