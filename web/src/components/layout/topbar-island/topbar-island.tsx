'use client'

import type { Transition, Variants } from 'motion/react'
import type { ReactNode } from 'react'
import type { SwipeDirection } from './island-gestures'
import type { IslandPanelPhase } from './island-panel-phase'
import type { IslandActivity, IslandGlow, QueuedIslandAlert } from '@/contexts/topbar-island'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { EyeOffIcon } from 'lucide-react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SiteLogo } from '@/components/common/site-logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSiteInfo } from '@/contexts/site-info-context'
import { finishIslandAlert, setIslandSettings, useIslandState } from '@/contexts/topbar-island'
import { cn } from '@/lib/utils'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { AmbientIsland, NetworkIsland } from './ambient-island'
import { continuousCapsulePath } from './continuous-capsule'
import { useIslandGestures, usePanelSwipeUp } from './island-gestures'
import { CROSSFADE_MS, morphIsland, nextFrame, waitForSettled } from './island-morph'
import { IslandPanelPhaseContext } from './island-panel-phase'
import { IslandSlot, IslandText } from './island-parts'
import { MusicIsland } from './music-island'

/**
 * 胶囊形变的弹簧：比顶栏收起展开（响应 0.45 秒、阻尼比 0.825）更利落一点，换算自响应时间 0.38 秒、阻尼比 0.75：
 * 刚度 = (2π / 响应时间)²，阻尼 = 4π × 阻尼比 / 响应时间（质量为 1），带一点回弹，像灵动岛那样「弹」开
 */
const ISLAND_SPRING: Transition = { type: 'spring', mass: 1, stiffness: 273, damping: 25 }
// 提示默认停留时长
const ALERT_MS = 2400
// 手势切换内容：新内容从滑动的一侧移入的距离、方向保持的时长，隐藏 / 恢复的读屏播报保留时长
const CONTENT_SHIFT_PX = 24
const CONTENT_SWITCH_MS = 400
const ANNOUNCE_MS = 4000

// 胶囊与小圆点共用的外观：按钮本身透明，只负责尺寸、形变与焦点环；深色药丸（浅色、深色主题下都是黑色，同灵动岛）画在内层，
// 内层的细描边让它在深色卡片上也有边界（胶囊静止时改由连续曲率的轮廓画出，见 useContinuousCapsule）
const capsuleClass = 'relative flex h-9 min-w-9 max-w-full shrink cursor-pointer items-center text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const capsuleBodyClass = 'relative isolate flex h-full min-w-0 flex-1 items-center overflow-hidden bg-neutral-950 transition-shadow duration-500'
const CAPSULE_RING = '0 0 0 1px rgb(255 255 255 / 0.1)'
// 胶囊高度（h-9）：展开的面板向上偏移这么多，盖在胶囊上
const CAPSULE_HEIGHT_PX = 36
// 展开面板统一的圆角（32px，参考 Apple 灵动岛展开后的大圆角）：活动自带的弹层外观（如音乐用悬浮播放器的弹层）也换成它，形变按它计算；
// 面板里贴边的内容按同心圆角留出边距（见下方「在顶栏隐藏」一行）
const PANEL_RADIUS_CLASS = 'rounded-[2rem] overflow-hidden'
// 描边辉光：1.5px 描边 + 外发光；高亮时外发光范围更大、更亮（只变光，胶囊大小不变）
const GLOW = {
  normal: { blur: 18, spread: 2, mix: 55 },
  strong: { blur: 32, spread: 4, mix: 70 },
}

function glowShadowOf({ color, strong }: IslandGlow) {
  const { blur, spread, mix } = GLOW[strong ? 'strong' : 'normal']
  return `0 0 0 1.5px ${color}, 0 0 ${blur}px ${spread}px color-mix(in oklab, ${color} ${mix}%, transparent)`
}

// 轮廓上的外发光用阴影滤镜画：滤镜的模糊取标准差，约为阴影模糊半径的一半
function glowFilterOf({ color, strong }: IslandGlow) {
  const { blur, mix } = GLOW[strong ? 'strong' : 'normal']
  return `drop-shadow(0 0 ${blur / 2}px color-mix(in oklab, ${color} ${mix}%, transparent))`
}

/**
 * 胶囊的连续曲率轮廓（见 continuous-capsule.ts）：静止时按当前尺寸生成路径，裁剪内层，并在内层之下画出描边与辉光；
 * 布局形变期间 motion 用缩放做动画，路径会跟着被拉伸，此时撤掉裁剪与轮廓，回落到 motion 修正过的普通圆角与阴影（两者相差不到 1px）。
 * 胶囊太窄、放不下过渡段时同样保留普通圆角
 */
function useContinuousCapsule(enabled: boolean) {
  const bodyElRef = useRef<HTMLSpanElement | null>(null)
  const outlineRef = useRef<SVGPathElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const pathRef = useRef<string | null>(null)
  const morphingRef = useRef(false)
  const watchRef = useRef(0)
  const apply = useCallback(() => {
    const body = bodyElRef.current
    if (!body)
      return
    const path = morphingRef.current ? null : pathRef.current
    body.style.clipPath = path ? `path("${path}")` : ''
    outlineRef.current?.setAttribute('d', path ?? '')
  }, [])

  // 回调 ref：有没有面板时外层结构不同（Popover 包裹与否），切换活动时按钮会重新挂载，需要跟着换观察的元素
  const bodyRef = useCallback((node: HTMLSpanElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    bodyElRef.current = node
    pathRef.current = null
    if (!node || !enabled)
      return
    // 按布局尺寸生成（offsetWidth 不受形变时的缩放影响）
    const update = () => {
      pathRef.current = continuousCapsulePath(node.offsetWidth, node.offsetHeight)
      apply()
    }
    update()
    observerRef.current = new ResizeObserver(update)
    observerRef.current.observe(node)
  }, [apply, enabled])

  useEffect(() => () => {
    observerRef.current?.disconnect()
    cancelAnimationFrame(watchRef.current)
  }, [])

  // 形变开始时撤掉轮廓，逐帧等到按钮的缩放回到原样再恢复：形变被新的渲染打断时 motion 不会通知结束（只有正常播完才有 onComplete）
  const onLayoutAnimationStart = useCallback(() => {
    morphingRef.current = true
    apply()
    if (watchRef.current)
      return
    const watch = () => {
      const shell = bodyElRef.current?.parentElement
      if (shell && getComputedStyle(shell).transform !== 'none') {
        watchRef.current = requestAnimationFrame(watch)
        return
      }
      watchRef.current = 0
      morphingRef.current = false
      apply()
    }
    watchRef.current = requestAnimationFrame(watch)
  }, [apply])

  // 是否被展开形变切换过显隐（之后胶囊的显隐瞬间完成，挂载时的入场仍然渐显）
  const toggledRef = useRef(false)
  return {
    bodyRef,
    outlineRef,
    onLayoutAnimationStart,
    get toggled() {
      return toggledRef.current
    },
    set toggled(value: boolean) {
      toggledRef.current = value
    },
  }
}

/**
 * 顶栏标题区（灵动岛，实验性）：左侧始终是回到首页的站点链接；有活动或提示时站名收起为图标，旁边弹出一枚胶囊。
 * - 活动按优先级仲裁：第一名占胶囊，第二名（有 minimal 时）缩成旁边的小圆点；提示短暂抢占胶囊，显示完回到原来的活动
 * - 点按胶囊：有面板时展开面板（后台可关闭），否则执行活动的 onPress；正在显示的提示被点按时立即结束
 * - 手势参考 Apple 灵动岛：长按展开，左右滑动轮换活动、滑走提示、隐藏唯一的活动（在站名上再滑一次恢复），面板上滑收起；见 IslandButton
 * - 悬停、聚焦或面板打开期间提示不计时（不会在读到一半时消失）
 * - 胶囊的无障碍名称为活动摘要，内容本身对读屏隐藏；提示通过 polite 播报区朗读一次
 * - 形变由 motion 的布局动画完成，遵循系统「减少动态效果」设置（只保留淡入淡出）
 * 后台总开关关闭时只显示站名
 */
export function TopbarIsland() {
  const { siteInfo } = useSiteInfo()
  const settings = siteInfo.island ?? fallbackSiteInfo.island!

  useEffect(() => {
    setIslandSettings(settings)
    return () => setIslandSettings(null)
  }, [settings])

  return (
    // 不包 LayoutGroup：AnimatePresence 里的退场全部播完时会调用它的 forceRender，让组里所有元素无视 layoutDependency 重新测量；
    // 胶囊内容的交叉淡入一结束就会触发一次，而此时胶囊还在形变，从半途测出的位置重新起动画，切换活动时就会「走两遍」。
    // 小圆点跟着胶囊重新测量改由它的 layoutKey 完成
    <MotionConfig reducedMotion="user">
      <IslandStage settings={settings} />
      {settings.enabled && (
        <>
          {settings.music && <MusicIsland settings={settings} />}
          {settings.network && <NetworkIsland />}
          {(settings.greeting || settings.holiday) && <AmbientIsland settings={settings} />}
        </>
      )}
    </MotionConfig>
  )
}

function IslandStage({ settings }: { settings: IslandSettings }) {
  const t = useTranslations('TopbarIsland')
  const { activities, alerts } = useIslandState()
  // 读者滑走隐藏的活动：id → 隐藏时的 sessionKey（同一段活动内保持隐藏，活动撤下或 sessionKey 变化后重新出现）
  const [hidden, setHidden] = useState<ReadonlyMap<string, string | undefined>>(() => new Map())
  // 读者滑动、点小圆点选中的主活动；有新活动出现时回到按优先级仲裁
  const [focusId, setFocusId] = useState<string | null>(null)
  // 手势切换时新内容从哪一侧进来（1 右侧、-1 左侧），切换完回到原地淡入
  const [enterFrom, setEnterFrom] = useState<{ id: string, from: 1 | -1 } | null>(null)
  const [announce, setAnnounce] = useState('')
  const allowed = settings.enabled ? activities.filter(activity => settings[activity.feature]) : []
  const visible = allowed.filter(activity => !activity.standby && !(hidden.has(activity.id) && hidden.get(activity.id) === activity.sessionKey))
  // 当前展开面板所属的活动与展开时的页面：活动撤下、换成别的活动或切换页面（如从面板进入播放器页）后自然失效，回来时不会自己再弹开；
  // 同时记下展开时的面板，展开期间活动换成没有面板的样子时接着用（见下面的 primary）
  const pathname = usePathname()
  const [opened, setOpened] = useState<{ id: string, pathname: string, keep: Pick<IslandActivity, 'panel' | 'panelClassName' | 'panelStyle'> } | null>(null)
  const openId = opened?.pathname === pathname ? opened.id : null
  const openPanel = (activity: IslandActivity | null) => setOpened(activity
    ? { id: activity.id, pathname, keep: { panel: activity.panel, panelClassName: activity.panelClassName, panelStyle: activity.panelStyle } }
    : null)
  const panelOpen = !!openId && visible.some(activity => activity.id === openId)
  // 展开期间主活动固定为展开的那个，不按优先级换掉（参考 Apple：在展开的灵动岛里暂停音乐不会收起）；
  // 活动换成了没有面板的样子（如音乐暂停后缩成封面 + 播放键）时面板接着显示展开时的内容，收起后再换成新的样子
  const current = visible.find(activity => activity.id === (panelOpen ? openId : focusId)) ?? visible[0]
  // 合成的活动按依赖缓存：胶囊的布局动画以活动为依赖，每次渲染换一个新对象会反复重新测量
  const keep = panelOpen && current?.id === openId && !current.panel ? opened?.keep : undefined
  const primary = useMemo(() => current && keep?.panel ? { ...current, ...keep } : current, [current, keep])
  const secondary = visible.find(activity => activity.id !== primary?.id && activity.minimal)
  // 悬停 / 聚焦在岛上时暂停提示计时
  const [holding, setHolding] = useState(false)
  const alert = settings.enabled && !panelOpen ? alerts[0] : undefined
  // 小圆点在主活动展开成面板时先收起；小圆点空出来之后换一个共享布局的标识，之后再出现的小圆点原地出现，
  // 不会接着很久以前那一个的位置飞过来（只有对调时才新旧相接）
  const showDot = !!secondary && !panelOpen
  const [dotEpoch, setDotEpoch] = useState(0)
  useEffect(() => {
    if (!showDot)
      setDotEpoch(epoch => epoch + 1)
  }, [showDot])

  useEffect(() => {
    if (!alert || holding)
      return
    const timer = window.setTimeout(finishIslandAlert, alert.duration ?? ALERT_MS, alert.seq)
    return () => window.clearTimeout(timer)
  }, [alert, holding])

  // 有新活动登记时让优先级重新生效；撤下的活动不再记着隐藏
  const idsRef = useRef<string[]>([])
  useEffect(() => {
    const ids = activities.map(activity => activity.id)
    if (ids.some(id => !idsRef.current.includes(id)))
      setFocusId(null)
    idsRef.current = ids
    setHidden(prev => [...prev.keys()].every(id => ids.includes(id)) ? prev : new Map([...prev].filter(([id]) => ids.includes(id))))
  }, [activities])

  useEffect(() => {
    if (!enterFrom)
      return
    const timer = window.setTimeout(setEnterFrom, CONTENT_SWITCH_MS, null)
    return () => window.clearTimeout(timer)
  }, [enterFrom])

  useEffect(() => {
    if (!announce)
      return
    const timer = window.setTimeout(setAnnounce, ANNOUNCE_MS, '')
    return () => window.clearTimeout(timer)
  }, [announce])

  /** 轮换主活动：step 为 1 时换到下一个（新内容从右侧进来），-1 时换到上一个；只有一个活动时返回 false */
  const cycle = (step: 1 | -1) => {
    if (visible.length < 2 || !primary)
      return false
    const index = visible.indexOf(primary)
    const next = visible[(index + step + visible.length) % visible.length]
    setEnterFrom({ id: next.id, from: step })
    setFocusId(next.id)
    openPanel(null)
    return true
  }
  const hide = (activity: IslandActivity) => {
    setHidden(prev => new Map(prev).set(activity.id, activity.sessionKey))
    if (focusId === activity.id)
      setFocusId(null)
    openPanel(null)
    setAnnounce(t('hidden_announce', { label: activity.label }))
  }
  const restore = () => {
    if (hidden.size === 0)
      return false
    setHidden(new Map())
    setAnnounce(t('restored_announce'))
    return true
  }
  // 胶囊上的横向滑动（参考 Apple）：提示 → 滑走；多个活动 → 轮换（手指向左滑换到下一个）；只有一个且允许隐藏 → 隐藏
  const swipeCapsule = (direction: SwipeDirection) => {
    if (alert) {
      finishIslandAlert(alert.seq)
      return true
    }
    if (cycle(direction === -1 ? 1 : -1))
      return true
    if (primary?.hideable) {
      hide(primary)
      return true
    }
    return false
  }

  const active = !!(alert || primary)

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onPointerEnter={() => setHolding(true)}
      onPointerLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={() => setHolding(false)}
    >
      {/* 站名与胶囊互相替换：岛上有内容时站名淡出、胶囊从它的位置长出来，没有内容时再变回站名 */}
      <AnimatePresence initial={false} mode="popLayout">
        {active
          ? (
              <IslandButton
                key="capsule"
                shape="capsule"
                activity={primary}
                alert={alert}
                expandable={settings.expand}
                open={!!primary && openId === primary.id}
                onOpenChange={(open) => {
                  openPanel(open && primary ? primary : null)
                  // 收起时它已经不是优先级最高的（如展开时暂停了音乐）：留在主位，不在收起后马上换成别的活动
                  if (!open && primary && visible[0]?.id !== primary.id)
                    setFocusId(primary.id)
                }}
                enterFrom={primary && enterFrom?.id === primary.id ? enterFrom.from : 0}
                onSwipe={swipeCapsule}
                onCycle={cycle}
                onHide={primary?.hideable ? () => hide(primary) : undefined}
              />
            )
          : <SiteLink key="site" onRestore={hidden.size > 0 ? restore : undefined} />}
        {/* 主活动展开成面板时小圆点先收起，面板收回后再出现 */}
        {showDot && (
          // 小圆点（参考 Apple 的 minimal）：点按换成主活动，长按换过来并展开它的面板
          <IslandButton
            key={`dot-${secondary.id}`}
            shape="dot"
            activity={secondary}
            expandable={settings.expand}
            open={false}
            onOpenChange={() => {}}
            // 小圆点跟着胶囊的形变移动：胶囊的内容一变就重新测量位置（不然胶囊还在伸缩时它已经先跳到终点）
            layoutKey={alert ?? primary}
            layoutId={`island-dot-${dotEpoch}`}
            onSelect={(expand) => {
              setEnterFrom({ id: secondary.id, from: 1 })
              setFocusId(secondary.id)
              openPanel(expand && settings.expand && secondary.panel ? secondary : null)
            }}
          />
        )}
      </AnimatePresence>
      {/* 读屏播报：提示出现时朗读一次；隐藏、恢复活动后说明怎么找回 */}
      <span role="status" aria-live="polite" className="sr-only">
        {alert ? (alert.announce ?? alert.text) : announce}
      </span>
    </div>
  )
}

/**
 * 回到首页的站点链接（图标 + 站名，窄屏只显示站名）。岛上有内容时整个让位给胶囊，
 * 此时回到首页的入口为主菜单的「首页」（移动端在侧边菜单里）。
 * 有被滑走隐藏的活动时，在站名上左右滑动（或聚焦后按左右方向键）恢复，同 Apple「再滑一次重新显示」
 */
function SiteLink({ ref, onRestore }: { ref?: React.Ref<HTMLDivElement>, onRestore?: () => boolean }) {
  const { siteInfo } = useSiteInfo()
  const name = siteInfo.metadata.name
  const linkRef = useRef<HTMLAnchorElement>(null)
  const gestures = useIslandGestures({ onSwipe: onRestore ? () => onRestore() : undefined, follow: () => linkRef.current })
  const setRef = useMergedRef(ref, gestures.ref)
  return (
    <motion.div
      ref={setRef}
      initial={{ opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, filter: 'blur(4px)' }}
      transition={{ duration: 0.2 }}
      className={cn('flex min-w-0 shrink', onRestore && 'touch-pan-y touch-pinch-zoom')}
      {...(onRestore ? gestures.handlers : {})}
      onKeyDown={(event) => {
        if (onRestore && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && onRestore())
          event.preventDefault()
      }}
    >
      <Link
        ref={linkRef}
        href="/"
        className="flex h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-lg font-bold text-primary transition-[background-color,transform] duration-150 hover:bg-primary/10 active:scale-[.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-[359px]:text-base sm:px-3"
      >
        {/* 窄屏省略图标，把空间留给站名 */}
        <span className="hidden shrink-0 items-center justify-center sm:flex">
          <SiteLogo />
        </span>
        <span className="truncate md:max-w-[28ch] lg:max-w-[36ch]">{name}</span>
      </Link>
    </motion.div>
  )
}

/** 把同一个元素同时交给两个 ref（AnimatePresence / PopoverTrigger 给的 ref 与手势的 ref）；任一 ref 变化时重新挂载 */
function useMergedRef<T>(first: React.Ref<T> | undefined, second: React.Ref<T> | undefined) {
  return useCallback((node: T | null) => {
    for (const ref of [first, second]) {
      if (typeof ref === 'function')
        ref(node)
      else if (ref)
        (ref as React.RefObject<T | null>).current = node
    }
  }, [first, second])
}

/**
 * 面板里形变时淡入淡出的内容层：挂载（Radix 打开）时把自己与切换阶段的函数交给 onMount 播放展开，返回的函数在卸载时调用。
 * 用自己的元素而不是外层的 ref：子组件的 layout effect 先于父元素的 ref 挂上，而面板就是它的父元素
 */
function MorphContent({ onMount, children }: { onMount: (content: HTMLDivElement, setPhase: (phase: IslandPanelPhase) => void) => (() => void) | void, children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // 面板所处的阶段（见 island-panel-phase.ts）：每次打开都重新挂载，从展开开始
  const [phase, setPhase] = useState<IslandPanelPhase>('opening')
  useLayoutEffect(() => (ref.current ? onMount(ref.current, setPhase) : undefined), [onMount])
  return (
    <IslandPanelPhaseContext value={phase}>
      <div ref={ref}>{children}</div>
    </IslandPanelPhaseContext>
  )
}

/**
 * 面板的展开 / 收起形变（见 island-morph.ts）：挂载后等定位与排版完成再从胶囊长出来；收起请求先播完收起再关闭，
 * 展开途中收到的收起请求等展开播完；中途卸载时立即停止并清理
 */
function usePanelMorph(capsuleRef: React.RefObject<HTMLButtonElement | null>, onOpenChange: (open: boolean) => void, setCapsuleHidden: (hidden: boolean) => void) {
  // 当前打开的面板（Radix 的弹层内容）与其中的内容层、切换面板阶段的函数，由 MorphContent 挂载时写入
  const elementsRef = useRef<{ panel: HTMLElement, content: HTMLElement, setPhase: (phase: IslandPanelPhase) => void } | null>(null)
  const stateRef = useRef({ opening: false, closing: false, closeQueued: false })
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })

  const requestClose = useCallback(() => {
    const state = stateRef.current
    if (state.closing)
      return
    if (state.opening) {
      state.closeQueued = true
      return
    }
    const elements = elementsRef.current
    const capsule = capsuleRef.current
    if (!elements || !capsule) {
      onOpenChangeRef.current(false)
      return
    }
    const { panel, content, setPhase } = elements
    state.closing = true
    // 先告诉面板里的内容开始收起（如音乐把歌词引擎交还给胶囊，胶囊在面板底下跟上此刻的画面）
    setPhase('closing')
    void morphIsland({ direction: 'close', capsule, panel, content }).then(async (result) => {
      // 缩回胶囊的形状后，胶囊先在面板底下显示，面板（此时就是带着播放器背景的胶囊形状）再淡出，两者交叉，不经过纯黑
      setCapsuleHidden(false)
      await nextFrame()
      await result.fadeOut()
      // 淡出后面板就一直藏着（不恢复，马上卸载）：关闭的渲染由 React 稍后提交，清理时取消动画若早于卸载，
      // 面板会以展开的样子回来一帧（收起末尾闪一下整张面板）；清理也等面板真正离开页面之后再做
      panel.style.visibility = 'hidden'
      onOpenChangeRef.current(false)
      for (let i = 0; i < 30 && panel.isConnected; i++)
        await nextFrame()
      result.cleanup()
      state.closing = false
    })
  }, [capsuleRef, setCapsuleHidden])

  const runOpen = useCallback((content: HTMLDivElement, setPhase: (phase: IslandPanelPhase) => void) => {
    const panel = content.parentElement
    const capsule = capsuleRef.current
    if (!panel || !capsule) {
      setPhase('open')
      return
    }
    elementsRef.current = { panel, content, setPhase }
    const state = stateRef.current
    state.opening = true
    state.closeQueued = false
    // 等定位与排版时先透明，第一帧就从胶囊的样子开始
    panel.style.opacity = '0'
    const controller = new AbortController()
    void (async () => {
      await waitForSettled(panel)
      if (controller.signal.aborted)
        return
      // 面板与外壳在胶囊处淡入，盖严之后再隐藏胶囊
      const hideTimer = window.setTimeout(setCapsuleHidden, CROSSFADE_MS, true)
      controller.signal.addEventListener('abort', () => window.clearTimeout(hideTimer), { once: true })
      const result = await morphIsland({ direction: 'open', capsule, panel, content, signal: controller.signal })
      result.cleanup()
      if (controller.signal.aborted)
        return
      state.opening = false
      setPhase('open')
      if (state.closeQueued) {
        state.closeQueued = false
        requestClose()
      }
      // 键盘打开时焦点交给面板（形变期间面板是透明的，弹层自己的自动聚焦落不进去）
      else if (capsule.contains(document.activeElement)) {
        panel.focus({ preventScroll: true })
      }
    })()
    return () => {
      controller.abort()
      state.opening = false
      panel.style.opacity = ''
      elementsRef.current = null
      // 展开途中被关掉（如切到别的活动）：胶囊恢复显示
      if (!state.closing)
        setCapsuleHidden(false)
    }
  }, [capsuleRef, requestClose, setCapsuleHidden])

  return { runOpen, requestClose }
}

// 内容交叉淡入；手势切换时新内容从滑动的一侧进来、旧内容往另一侧退出
const CONTENT_VARIANTS: Variants = {
  enter: (from: number) => ({ opacity: 0, filter: 'blur(6px)', scale: 0.92, x: from * CONTENT_SHIFT_PX }),
  shown: { opacity: 1, filter: 'blur(0px)', scale: 1, x: 0 },
  leave: (from: number) => ({ opacity: 0, filter: 'blur(6px)', scale: 0.92, x: -from * CONTENT_SHIFT_PX }),
}

/**
 * 胶囊（shape="capsule"）或第二活动的小圆点（shape="dot"）。胶囊显示提示或活动内容，内容切换时新旧内容交叉淡入、胶囊宽度随之形变；
 * 有面板时为面板的触发按钮。手势（参考 Apple 灵动岛，见 island-gestures.ts）：
 * - 胶囊：点按展开面板，长按同样展开；左右滑动或触控板横扫轮换活动、滑走提示、隐藏唯一的活动；聚焦时左右方向键轮换
 * - 小圆点：点按换成主活动，长按换过来并展开面板（onSelect）
 * - 面板：触屏上滑收起；允许隐藏的活动在面板底部有「在顶栏隐藏」（滑动之外的等价操作）
 * 展开时面板盖在胶囊的位置上，由胶囊本身长成面板（封面放大、歌词移到面板里的位置等，见 island-morph.ts），收起时缩回胶囊；
 * 所有收起的途径（点外面、Esc、上滑、面板里的关闭按钮）都先播完收起再真正关闭
 */
function IslandButton({ ref, shape, activity, alert, expandable, open, onOpenChange, enterFrom = 0, onSwipe, onCycle, onHide, onSelect, layoutKey, layoutId }: {
  // AnimatePresence 的 popLayout 需要拿到元素测量位置；有面板时由 PopoverTrigger 合并到同一个按钮上
  ref?: React.Ref<HTMLButtonElement>
  shape: 'capsule' | 'dot'
  activity?: IslandActivity
  alert?: QueuedIslandAlert
  expandable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  enterFrom?: 1 | -1 | 0
  onSwipe?: (direction: SwipeDirection) => boolean
  onCycle?: (step: 1 | -1) => boolean
  onHide?: () => void
  // 小圆点：点按（expand 为 false）或长按（为 true）时调用，不再作为面板的触发按钮
  onSelect?: (expand: boolean) => void
  // 什么变化时重新测量布局、播放形变，默认为自己的内容（提示或活动）
  layoutKey?: unknown
  // 小圆点的共享布局标识：对调时新的小圆点接着旧的位置出发
  layoutId?: string
}) {
  const t = useTranslations('TopbarIsland')
  const panel = expandable && !onSelect ? activity?.panel : undefined
  const isDot = shape === 'dot'
  const content: ReactNode = alert
    ? <AlertContent alert={alert} />
    : isDot ? activity?.minimal : activity?.compact
  const contentKey = alert ? `alert:${alert.key}:${alert.count}` : `activity:${activity?.id}`
  const label = alert ? alert.text : activity?.label
  const glow = !alert && !isDot ? activity?.glow ?? null : null
  // 只在岛的内容变化时测量布局、播放形变。motion 默认每次渲染都按页面坐标测量，而岛在吸顶的顶栏里：
  // 站内跳转时顶栏随路由重新渲染，同时页面滚动回到顶部，会被当成胶囊移动了一整屏，从下方飞回原位
  // （layoutRoot 只对 position: fixed 的容器生效，吸顶的顶栏用不了）
  const layoutDependency = layoutKey ?? alert ?? activity
  const capsule = useContinuousCapsule(!isDot)
  // 副歌辉光：描边 + 外发光，只改颜色与光的范围，不改胶囊大小（音乐相关的变化都不让岛的尺寸跟着起伏）
  const glowShadow = glow ? glowShadowOf(glow) : CAPSULE_RING

  const press = () => {
    if (alert) {
      finishIslandAlert(alert.seq)
      alert.onPress?.()
      return
    }
    if (onSelect)
      onSelect(false)
    else if (!panel)
      activity?.onPress?.()
  }
  // 当前显示的内容元素：拖动时跟手平移（新内容挂载后指向新的，退出中的旧内容不再跟手）
  const contentElRef = useRef<HTMLSpanElement | null>(null)
  const gestures = useIslandGestures({
    onSwipe,
    follow: () => contentElRef.current,
    // 长按（参考 Apple 的 touch and hold）：展开面板；小圆点换成主活动并展开；没有面板时同点按
    onLongPress: () => {
      if (onSelect)
        onSelect(true)
      else if (panel && !alert)
        onOpenChange(true)
      else
        press()
    },
  })
  const capsuleElRef = useRef<HTMLButtonElement | null>(null)
  const setRef = useMergedRef(ref, useMergedRef(gestures.ref, capsuleElRef))
  // 面板展开期间胶囊隐藏（由形变在开始与结束时切换，见 usePanelMorph）
  const [capsuleHidden, setCapsuleHidden] = useState(false)
  const morph = usePanelMorph(capsuleElRef, onOpenChange, setCapsuleHidden)
  capsule.toggled ||= capsuleHidden
  const panelSwipe = usePanelSwipeUp(morph.requestClose)

  const button = (
    <motion.button
      ref={setRef}
      type="button"
      layout
      layoutDependency={layoutDependency}
      // 换了小圆点（如点小圆点与胶囊对调）时新的接着旧的：从旧的位置出发、与它交叉淡入，随胶囊的右缘一起滑到终点，
      // 不会先出现在终点、盖在还没缩完的胶囊上，再被拉回去重走一遍
      layoutId={layoutId}
      data-island-capsule={isDot ? undefined : ''}
      aria-label={label}
      aria-keyshortcuts={onCycle ? 'ArrowLeft ArrowRight' : undefined}
      initial={{ opacity: 0, scale: 0.5 }}
      // 面板展开期间（含收起动画）胶囊隐藏：面板就是它长大的样子。只让盖在上面的外壳淡入淡出，胶囊本身瞬间隐藏 / 显示
      // （外壳不透明时才切换，两者不会同时半透明、透出底下的页面）；由 motion 自己设置，用 CSS 类隐藏时 motion 不知道，
      // 之后某次动画会从读到的 0 开始淡入，收起后胶囊先空一帧再慢慢出现
      animate={{ opacity: capsuleHidden ? 0 : 1, scale: 1, transition: capsule.toggled ? { ...ISLAND_SPRING, opacity: { duration: 0 } } : ISLAND_SPRING }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={ISLAND_SPRING}
      onLayoutAnimationStart={capsule.onLayoutAnimationStart}
      {...gestures.handlers}
      onClick={(event) => {
        // 提示自带操作、小圆点切换、没有面板时不让弹层自己开合（按钮始终是弹层的触发器，见下方）
        if (alert?.onPress || onSelect || !panel)
          event.preventDefault()
        press()
      }}
      // 没有面板时去掉触发器附带的弹出语义
      {...(!panel && { 'aria-haspopup': undefined, 'aria-expanded': undefined, 'aria-controls': undefined })}
      onKeyDown={(event) => {
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && onCycle?.(event.key === 'ArrowRight' ? 1 : -1))
          event.preventDefault()
      }}
      // 圆角写在 style 里，布局动画缩放时由 motion 修正，保持药丸形状（焦点环沿用）
      style={{
        borderRadius: 999,
        // 胶囊从站名的左端长出来，小圆点从中心弹出
        originX: isDot ? 0.5 : 0,
      }}
      // 胶囊左缘与站点图标对齐（同站点链接的内边距）；横向的拖动由手势接管，竖向仍可滚动页面；触屏长按不选中文字、不弹系统菜单
      className={cn(capsuleClass, 'touch-pan-y touch-pinch-zoom select-none [-webkit-touch-callout:none]', isDot ? 'size-9 shrink-0 justify-center' : 'ml-2 sm:ml-3')}
    >
      {/* 连续曲率的描边与辉光，在内层之下：描边宽度的一半露在外面（描边 1px，辉光 1.5px），外发光由阴影滤镜画出 */}
      {!isDot && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 size-full overflow-visible transition-[filter] duration-500"
          style={{ filter: glow ? glowFilterOf(glow) : undefined }}
        >
          <path
            ref={capsule.outlineRef}
            fill={glow?.color ?? 'transparent'}
            stroke={glow?.color ?? 'rgb(255 255 255 / 0.1)'}
            strokeWidth={glow ? 3 : 2}
            className="transition-[fill,stroke] duration-500"
          />
        </svg>
      )}
      {/* 药丸本体：形变时同样由 motion 修正圆角与阴影；静止时由 useContinuousCapsule 裁剪成连续曲率（自身的阴影随之被裁掉，改由上面的轮廓画出） */}
      <motion.span
        ref={capsule.bodyRef}
        layout
        layoutDependency={layoutDependency}
        transition={ISLAND_SPRING}
        style={{ borderRadius: 999, boxShadow: glowShadow }}
        className={cn(capsuleBodyClass, isDot && 'justify-center')}
      >
        <AnimatePresence initial={false} mode="popLayout" custom={enterFrom}>
          <motion.span
            key={contentKey}
            ref={(node: HTMLSpanElement | null) => {
              if (node)
                contentElRef.current = node
            }}
            layout="position"
            layoutDependency={layoutDependency}
            aria-hidden
            custom={enterFrom}
            variants={CONTENT_VARIANTS}
            initial="enter"
            animate="shown"
            exit="leave"
            transition={{ duration: 0.22 }}
            // 两端元素与端头半圆同心（各留 6px），比例见 island-parts.tsx
            className={cn('flex h-full min-w-0 items-center', isDot ? 'justify-center' : 'gap-1.5 px-1.5')}
          >
            {content}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </motion.button>
  )

  // 有没有面板都包一层弹层并以按钮为触发器：结构不随活动变化，切换活动（如播放中 ⇄ 暂停、点小圆点换过来）时按钮不会重新挂载，
  // 只做宽度形变；否则 React 会换掉按钮，重播从 0.5 倍放大的入场，旁边的小圆点也跟着跳一下
  return (
    <Popover open={!!panel && open} onOpenChange={next => (next ? panel && onOpenChange(true) : morph.requestClose())}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      {panel && (
        <PopoverContent
          align="start"
          // 面板盖在胶囊上（上边与胶囊上边对齐），由胶囊长成面板
          sideOffset={-CAPSULE_HEIGHT_PX}
          collisionPadding={8}
          // 默认深色与胶囊一致；活动可换成别处弹层的外观（如音乐用悬浮播放器的弹层）。阴影在形变结束后渐显；
          // 竖向拖动交给上滑收起（面板里可滚动的区域自己滚动）
          className={cn(
            activity?.panelClassName ?? 'w-[min(22rem,calc(100vw-1.5rem))] border-0 bg-neutral-950 p-4 text-white shadow-2xl ring-1 ring-white/10',
            PANEL_RADIUS_CLASS,
            // 不用弹层自带的进出场动画（缩放淡入淡出），由 island-morph 变换。要用 !important：tailwind-merge 不认识 animate-in / animate-out
            // 这两个插件类，普通的 animate-none 合并不掉它们；行内样式也不行（Radix 定位完成后会把行内的 animation 清掉）。
            // 没有出场动画时 Radix 立即卸载面板，收起播完不会再闪一次整张卡片
            'touch-pan-x touch-pinch-zoom transition-shadow duration-200 animate-none!',
          )}
          style={activity?.panelStyle}
          {...panelSwipe}
        >
          <MorphContent onMount={morph.runOpen}>
            {panel}
            {onHide && (
              // 隐藏的等价操作（滑动之外）：面板底部一行；默认面板有 p-4，用负外边距贴到边缘。按钮离右下角留够距离，不被大圆角裁掉
              <div data-island-morph-fade className={cn('flex justify-end border-t border-white/10 px-4 py-2', !activity?.panelClassName && '-mx-4 -mb-4 mt-4')}>
                <button
                  type="button"
                  onClick={onHide}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  <EyeOffIcon aria-hidden className="size-3.5" />
                  {t('hide_activity')}
                </button>
              </div>
            )}
          </MorphContent>
        </PopoverContent>
      )}
    </Popover>
  )
}

function AlertContent({ alert }: { alert: QueuedIslandAlert }) {
  return (
    <>
      {alert.icon && <IslandSlot>{alert.icon}</IslandSlot>}
      <IslandText>{alert.text}</IslandText>
      {alert.countable && alert.count > 1 && <IslandText className="shrink-0 text-white/60 tabular-nums">{`×${alert.count}`}</IslandText>}
    </>
  )
}
