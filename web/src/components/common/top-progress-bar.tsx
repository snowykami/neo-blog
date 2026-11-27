'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import {
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  getNavigationTransitionSnapshot,
  getServerNavigationTransitionSnapshot,
  normalizeNavigationPathname,
  normalizeNavigationSearch,
  notifyNavigationComplete,
  setCommittedNavigationLocation,
  subscribeNavigationTransition,
  subscribeRouterTransitionStart,
} from '@/lib/navigation-transition'

// 先快后慢的上凸（ease-out）进度曲线参数：
// 0ms -> 200ms 快速冲至 42%，600ms 推至 66%，随后按指数衰减步长缓步逼近 92% 封顶，完成瞬间推至 100% 淡出
const FAST_STAGE_PROGRESS = 0.42
const MID_STAGE_DELAY_MS = 200
const MID_STAGE_PROGRESS = 0.66
const DECAY_START_DELAY_MS = 600
const DECAY_STEP_INTERVAL_MS = 320
const DECAY_RATIO = 0.22
const MAX_PENDING_PROGRESS = 0.92
const FINISH_FADE_DELAY_MS = 140
const FINISH_HIDE_DELAY_MS = 320
const SAFETY_TIMEOUT_MS = 12_000

export function nextConvexProgress(current: number): number {
  if (current >= MAX_PENDING_PROGRESS)
    return MAX_PENDING_PROGRESS
  const next = current + (MAX_PENDING_PROGRESS - current) * DECAY_RATIO
  return Math.min(MAX_PENDING_PROGRESS, Math.round(next * 10000) / 10000)
}

function ProgressRouteWatcher({ onRouteCommit }: { onRouteCommit: (pathname: string, search: string) => void }) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const rawSearch = searchParams?.toString() ?? ''
  useLayoutEffect(() => {
    onRouteCommit(pathname, rawSearch)
  }, [pathname, rawSearch, onRouteCommit])
  return null
}

/**
 * 顶部细加载进度条：
 * - 由 instrumentation-client.ts 的 onRouterTransitionStart 驱动启动，结合 React Transition 纠缠提交与路由监听双重收尾，
 *   即便遇到 308 重定向回当前页、notFound() 或查询参数规范化也绝不卡死
 * - 全程仅使用 GPU 合成层属性（transform: scaleX + opacity）与 cubic-bezier(0.22, 1, 0.36, 1)
 * - 静置态不渲染内层节点、无常驻定时器；遵循 prefers-reduced-motion 跳过步进位移
 */
export function TopProgressBar() {
  const transition = useSyncExternalStore(
    subscribeNavigationTransition,
    getNavigationTransitionSnapshot,
    getServerNavigationTransitionSnapshot,
  )
  const [settledSeq, setSettledSeq] = useState(0)
  const [visible, setVisible] = useState(false)
  const [opacity, setOpacity] = useState(0)
  const [progress, setProgress] = useState(0)

  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const progressRef = useRef(0)
  const lastCommittedRouteRef = useRef<string | null>(null)
  const activeSeqRef = useRef(0)

  const clearScheduled = useCallback(() => {
    for (const timer of timersRef.current)
      clearTimeout(timer)
    timersRef.current = []
    if (decayTimerRef.current !== null) {
      clearTimeout(decayTimerRef.current)
      decayTimerRef.current = null
    }
    if (rafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => clearScheduled, [clearScheduled])

  // 与 Next.js App Router 的 startTransition 纠缠：用 useLayoutEffect 同步挂载，防止水合后首帧前点击漏捕获
  useLayoutEffect(() => {
    return subscribeRouterTransitionStart((seq) => {
      startTransition(() => {
        setSettledSeq(seq)
      })
    })
  }, [])

  useLayoutEffect(() => {
    if (transition.active && settledSeq >= transition.seq && transition.seq > 0)
      notifyNavigationComplete()
  }, [settledSeq, transition.active, transition.seq])

  const handleRouteCommit = useCallback((rawPathname: string, rawSearch: string) => {
    const normPath = normalizeNavigationPathname(rawPathname)
    const normSearch = normalizeNavigationSearch(rawSearch)
    setCommittedNavigationLocation(normPath, normSearch)
    const routeKey = `${normPath}${normSearch}`
    if (lastCommittedRouteRef.current === null) {
      lastCommittedRouteRef.current = routeKey
      return
    }
    if (lastCommittedRouteRef.current !== routeKey) {
      lastCommittedRouteRef.current = routeKey
      notifyNavigationComplete()
    }
  }, [])

  useEffect(() => {
    const applyProgress = (value: number) => {
      progressRef.current = value
      setProgress(value)
    }

    if (transition.active) {
      clearScheduled()
      activeSeqRef.current = transition.seq
      setVisible(true)
      setOpacity(1)

      const reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches

      if (reducedMotion) {
        applyProgress(1)
      }
      else {
        applyProgress(0.08)

        const startFastStage = () => {
          rafRef.current = null
          applyProgress(FAST_STAGE_PROGRESS)
        }
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
          rafRef.current = window.requestAnimationFrame(startFastStage)
        else
          timersRef.current.push(setTimeout(startFastStage, 16))

        timersRef.current.push(setTimeout(() => {
          if (progressRef.current < MID_STAGE_PROGRESS)
            applyProgress(MID_STAGE_PROGRESS)
        }, MID_STAGE_DELAY_MS))

        const scheduleDecayStep = (delay: number) => {
          decayTimerRef.current = setTimeout(() => {
            decayTimerRef.current = null
            const next = nextConvexProgress(progressRef.current)
            applyProgress(next)
            if (next < MAX_PENDING_PROGRESS - 0.003)
              scheduleDecayStep(DECAY_STEP_INTERVAL_MS)
          }, delay)
        }
        scheduleDecayStep(DECAY_START_DELAY_MS)
      }

      // 极端网络超时或导航被浏览器中止时的安全兜底收起
      timersRef.current.push(setTimeout(() => {
        notifyNavigationComplete()
      }, SAFETY_TIMEOUT_MS))
      return
    }

    if (activeSeqRef.current === 0)
      return

    clearScheduled()
    applyProgress(1)
    timersRef.current.push(setTimeout(() => {
      setOpacity(0)
    }, FINISH_FADE_DELAY_MS))
    timersRef.current.push(setTimeout(() => {
      activeSeqRef.current = 0
      setVisible(false)
      applyProgress(0)
    }, FINISH_HIDE_DELAY_MS))
  }, [clearScheduled, transition.active, transition.seq])

  return (
    <>
      <Suspense fallback={null}>
        <ProgressRouteWatcher onRouteCommit={handleRouteCommit} />
      </Suspense>
      {visible && (
        <div
          aria-hidden="true"
          data-top-progress=""
          className="pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5 overflow-hidden"
        >
          <div
            className="h-full w-full origin-left bg-primary shadow-[0_0_8px_var(--primary)] transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]"
            style={{
              transform: `scaleX(${progress})`,
              opacity,
            }}
          />
        </div>
      )}
    </>
  )
}
