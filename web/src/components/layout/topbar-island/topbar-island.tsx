'use client'

import type { Transition, Variants } from 'motion/react'
import type { ReactNode } from 'react'
import type { SwipeDirection } from './island-gestures'
import type { IslandActivity, IslandGlow, QueuedIslandAlert } from '@/contexts/topbar-island'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { EyeOffIcon } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'motion/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SiteLogo } from '@/components/common/site-logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSiteInfo } from '@/contexts/site-info-context'
import { finishIslandAlert, setIslandSettings, useIslandState } from '@/contexts/topbar-island'
import { cn } from '@/lib/utils'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { AmbientIsland, NetworkIsland } from './ambient-island'
import { continuousCapsulePath } from './continuous-capsule'
import { useIslandGestures, usePanelSwipeUp } from './island-gestures'
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

  return { bodyRef, outlineRef, onLayoutAnimationStart }
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
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="topbar-island">
        <IslandStage settings={settings} />
      </LayoutGroup>
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
  const visible = allowed.filter(activity => !(hidden.has(activity.id) && hidden.get(activity.id) === activity.sessionKey))
  const primary = visible.find(activity => activity.id === focusId) ?? visible[0]
  const secondary = visible.find(activity => activity !== primary && activity.minimal)
  // 当前展开面板所属的活动与展开时的页面：活动撤下、换成别的活动或切换页面（如从面板进入播放器页）后自然失效，回来时不会自己再弹开
  const pathname = usePathname()
  const [opened, setOpened] = useState<{ id: string, pathname: string } | null>(null)
  const openId = opened?.pathname === pathname ? opened.id : null
  const setOpenId = (id: string | null) => setOpened(id ? { id, pathname } : null)
  // 悬停 / 聚焦在岛上时暂停提示计时
  const [holding, setHolding] = useState(false)
  const panelOpen = !!openId && visible.some(activity => activity.id === openId)
  const alert = settings.enabled && !panelOpen ? alerts[0] : undefined

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
    setOpenId(null)
    return true
  }
  const hide = (activity: IslandActivity) => {
    setHidden(prev => new Map(prev).set(activity.id, activity.sessionKey))
    if (focusId === activity.id)
      setFocusId(null)
    setOpenId(null)
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
                onOpenChange={open => setOpenId(open && primary ? primary.id : null)}
                enterFrom={primary && enterFrom?.id === primary.id ? enterFrom.from : 0}
                onSwipe={swipeCapsule}
                onCycle={cycle}
                onHide={primary?.hideable ? () => hide(primary) : undefined}
              />
            )
          : <SiteLink key="site" onRestore={hidden.size > 0 ? restore : undefined} />}
        {secondary && (
          // 小圆点（参考 Apple 的 minimal）：点按换成主活动，长按换过来并展开它的面板
          <IslandButton
            key={`dot-${secondary.id}`}
            shape="dot"
            activity={secondary}
            expandable={settings.expand}
            open={false}
            onOpenChange={() => {}}
            onSelect={(expand) => {
              setEnterFrom({ id: secondary.id, from: 1 })
              setFocusId(secondary.id)
              setOpenId(expand && settings.expand && secondary.panel ? secondary.id : null)
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
 */
function IslandButton({ ref, shape, activity, alert, expandable, open, onOpenChange, enterFrom = 0, onSwipe, onCycle, onHide, onSelect }: {
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
  const layoutDependency = alert ?? activity
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
  const setRef = useMergedRef(ref, gestures.ref)
  const panelSwipe = usePanelSwipeUp(() => onOpenChange(false))

  const button = (
    <motion.button
      ref={setRef}
      type="button"
      layout
      layoutDependency={layoutDependency}
      data-island-capsule={isDot ? undefined : ''}
      aria-label={label}
      aria-keyshortcuts={onCycle ? 'ArrowLeft ArrowRight' : undefined}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={ISLAND_SPRING}
      onLayoutAnimationStart={capsule.onLayoutAnimationStart}
      {...gestures.handlers}
      onClick={(event) => {
        // 提示自带操作、小圆点切换时不展开面板
        if (alert?.onPress || onSelect)
          event.preventDefault()
        press()
      }}
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

  if (!panel)
    return button
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        collisionPadding={8}
        // 面板从胶囊处「长」出来：以触发处为原点放大，默认深色与胶囊一致；活动可换成别处弹层的外观（如音乐用悬浮播放器的弹层）。
        // 竖向拖动交给上滑收起（面板里可滚动的区域自己滚动）
        className={cn(activity?.panelClassName ?? 'w-[min(22rem,calc(100vw-1.5rem))] rounded-3xl border-0 bg-neutral-950 p-4 text-white shadow-2xl ring-1 ring-white/10 data-[state=open]:duration-300 data-[state=open]:zoom-in-75', 'touch-pan-x touch-pinch-zoom')}
        style={activity?.panelStyle}
        {...panelSwipe}
      >
        {panel}
        {onHide && (
          // 隐藏的等价操作（滑动之外）：面板底部一行；默认面板有 p-4，用负外边距贴到边缘
          <div className={cn('flex justify-end border-t border-white/10 px-3 py-1.5', !activity?.panelClassName && '-mx-4 -mb-4 mt-4')}>
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
      </PopoverContent>
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
