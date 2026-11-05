'use client'

import type { IslandActivity } from '@/contexts/topbar-island'
import type { TocHeading } from '@/models/toc'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { ArrowUpIcon, MessageCircleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getScrollOffset } from '@/components/blog-post/post-toc.client'
import { LikeIcon } from '@/contexts/theme-context'
import { pushIslandAlert, useIslandActivity } from '@/contexts/topbar-island'
import { cn } from '@/lib/utils'
import { ProgressRing } from './progress-ring'

// 低于播放中的音乐：同时存在时阅读进度缩成旁边的进度环
const READING_PRIORITY = 40
// 正文可滚动的距离至少为视口高度的这一比例才提示「读完」，一屏就能看完的短文不打扰
const FINISH_MIN_SCROLL_RATIO = 0.5
const FINISH_PROGRESS = 0.99
const FINISH_MS = 4500

interface ReadingSnapshot {
  // before：还没读到正文；reading：正文顶端已滚到顶栏下方；after：正文已整个滚出视口（到了评论区）
  phase: 'before' | 'reading' | 'after'
  // 0 ~ 1：正文末尾滚到视口底部时为 1
  progress: number
  // 当前章节在 headings 中的下标，读到第一个标题之前为 -1
  activeIndex: number
  // 正文可滚动的距离（px）
  scrollable: number
}

const INITIAL: ReadingSnapshot = { phase: 'before', progress: 0, activeIndex: -1, scrollable: 0 }

/** 每篇文章一份的阅读进度：滚动时逐帧更新，订阅方各取所需（章节只在换章时变化，进度环按百分比取整） */
function createReadingStore() {
  let snapshot = INITIAL
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set: (next: ReadingSnapshot) => {
      if (next.phase === snapshot.phase && next.activeIndex === snapshot.activeIndex && Math.abs(next.progress - snapshot.progress) < 0.001 && next.scrollable === snapshot.scrollable)
        return
      snapshot = next
      listeners.forEach(listener => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

type ReadingStore = ReturnType<typeof createReadingStore>

function scrollToElement(id: string) {
  const el = document.getElementById(id)
  if (el)
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - getScrollOffset(), behavior: 'smooth' })
}

/**
 * 文章阅读进度（挂在文章页）：正文读到一半时胶囊显示进度环 + 当前章节 + 剩余时间，点按展开迷你目录
 * （移动端侧栏目录不显示，这里补上）；读到末尾时提示一次「读完啦」，点按跳到点赞
 */
export function ReadingIsland({ title, headings, minutes }: { title: string, headings: TocHeading[], minutes: number }) {
  const t = useTranslations('TopbarIsland')
  const [store] = useState(createReadingStore)
  const phase = useSyncExternalStore(store.subscribe, () => store.get().phase, () => INITIAL.phase)
  const activeIndex = useSyncExternalStore(store.subscribe, () => store.get().activeIndex, () => INITIAL.activeIndex)

  useEffect(() => {
    const article = document.getElementById('blog-content')
    if (!article)
      return
    let frame = 0
    const measure = () => {
      frame = 0
      const offset = getScrollOffset()
      const rect = article.getBoundingClientRect()
      const scrollable = Math.max(0, rect.height - (window.innerHeight - offset))
      const read = offset - rect.top
      const progress = Math.min(1, Math.max(0, scrollable > 0 ? read / scrollable : read >= 0 ? 1 : 0))
      let activeIndex = -1
      for (let i = 0; i < headings.length; i++) {
        const el = document.getElementById(headings[i].id)
        if (!el || el.getBoundingClientRect().top - offset - 1 > 0)
          break
        activeIndex = i
      }
      const phase = rect.top > offset ? 'before' : rect.bottom < offset ? 'after' : 'reading'
      store.set({ phase, progress, activeIndex, scrollable })
    }
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // 图片加载、组件展开会改变正文高度
    const observer = new ResizeObserver(schedule)
    observer.observe(article)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [headings, store])

  // 读到末尾提示一次
  const finishedRef = useRef(false)
  useEffect(() => store.subscribe(() => {
    const { phase, progress, scrollable } = store.get()
    if (finishedRef.current || phase !== 'reading' || progress < FINISH_PROGRESS || scrollable < window.innerHeight * FINISH_MIN_SCROLL_RATIO)
      return
    finishedRef.current = true
    pushIslandAlert({
      key: 'reading-finish',
      feature: 'readingFinish',
      icon: <LikeIcon aria-hidden className="text-rose-400" />,
      text: t('reading_finish'),
      duration: FINISH_MS,
      onPress: () => scrollToElement('post-actions'),
    })
  }), [store, t])

  const chapter = activeIndex >= 0 ? headings[activeIndex].text : title
  const activity = useMemo<IslandActivity | null>(() => phase !== 'reading'
    ? null
    : {
        id: 'reading',
        feature: 'reading',
        priority: READING_PRIORITY,
        label: t('reading_label', { chapter }),
        compact: (
          <>
            <ReadingRing store={store} />
            <span className="max-w-[24ch] min-w-0 truncate">{chapter}</span>
            {/* 窄屏把空间留给章节名，进度看进度环 */}
            <RemainingTime store={store} minutes={minutes} className="hidden shrink-0 text-white/60 sm:inline" />
          </>
        ),
        minimal: <ReadingRing store={store} />,
        panel: <ReadingPanel store={store} headings={headings} minutes={minutes} />,
      }, [chapter, headings, minutes, phase, store, t])
  useIslandActivity(activity)

  return null
}

function usePercent(store: ReadingStore) {
  return useSyncExternalStore(store.subscribe, () => Math.round(store.get().progress * 100), () => 0)
}

/** 阅读进度环：按百分比取整订阅，整篇文章最多重渲染一百次 */
function ReadingRing({ store, className }: { store: ReadingStore, className?: string }) {
  return <ProgressRing percent={usePercent(store)} className={className} />
}

/** 剩余阅读时间：按全文阅读时长与未读比例估算，按分钟取整订阅 */
function RemainingTime({ store, minutes, className }: { store: ReadingStore, minutes: number, className?: string }) {
  const t = useTranslations('TopbarIsland')
  const left = useSyncExternalStore(store.subscribe, () => Math.ceil(minutes * (1 - store.get().progress)), () => minutes)
  return <span className={className}>{t('reading_left', { count: left })}</span>
}

/** 展开面板：进度、剩余时间、迷你目录与回到顶部 / 去评论区；点选后收起面板 */
function ReadingPanel({ store, headings, minutes }: { store: ReadingStore, headings: TocHeading[], minutes: number }) {
  const t = useTranslations('TopbarIsland')
  const commonT = useTranslations('Common')
  const percent = usePercent(store)
  const activeIndex = useSyncExternalStore(store.subscribe, () => store.get().activeIndex, () => -1)
  const minLevel = headings.length > 0 ? Math.min(...headings.map(heading => heading.level)) : 1
  const actionClass = 'inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-medium text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none'
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <ReadingRing store={store} className="size-10" />
        <div className="grid min-w-0 gap-0.5">
          <p className="font-semibold tabular-nums">{t('reading_progress', { percent })}</p>
          <RemainingTime store={store} minutes={minutes} className="text-sm text-white/60" />
        </div>
      </div>
      {headings.length > 0 && (
        <nav aria-label={commonT('table_of_contents')} className="-mx-1 max-h-[45dvh] overflow-y-auto px-1">
          <ul className="grid gap-0.5 text-sm">
            {headings.map((heading, index) => (
              <li key={heading.id} style={{ paddingLeft: `${(heading.level - minLevel) * 0.75}rem` }}>
                <PopoverPrimitive.Close asChild>
                  <button
                    type="button"
                    aria-current={index === activeIndex ? 'location' : undefined}
                    onClick={() => scrollToElement(heading.id)}
                    className={cn(
                      'flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
                      index === activeIndex ? 'bg-white/10 font-medium text-white' : 'text-white/70',
                    )}
                  >
                    <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', index === activeIndex ? 'bg-primary' : 'bg-white/25')} />
                    <span className="min-w-0 truncate">{heading.text}</span>
                  </button>
                </PopoverPrimitive.Close>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="flex gap-2">
        <PopoverPrimitive.Close asChild>
          <button type="button" className={actionClass} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <ArrowUpIcon aria-hidden className="size-4" />
            {commonT('back_to_top')}
          </button>
        </PopoverPrimitive.Close>
        <PopoverPrimitive.Close asChild>
          <button type="button" className={actionClass} onClick={() => scrollToElement('comments')}>
            <MessageCircleIcon aria-hidden className="size-4" />
            {t('reading_to_comments')}
          </button>
        </PopoverPrimitive.Close>
      </div>
    </div>
  )
}
