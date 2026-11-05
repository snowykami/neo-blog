'use client'

import type { Transition } from 'motion/react'
import type { ReactNode } from 'react'
import type { IslandActivity, QueuedIslandAlert } from '@/contexts/topbar-island'
import type { IslandSettings } from '@/utils/common/siteinfo'
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SiteLogo } from '@/components/common/site-logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSiteInfo } from '@/contexts/site-info-context'
import { finishIslandAlert, setIslandSettings, useIslandState } from '@/contexts/topbar-island'
import { cn } from '@/lib/utils'
import { fallbackSiteInfo } from '@/utils/common/siteinfo'
import { AmbientIsland, NetworkIsland } from './ambient-island'
import { IslandSlot, IslandText } from './island-parts'
import { MusicIsland } from './music-island'

/**
 * 胶囊形变的弹簧：比顶栏收起展开（响应 0.45 秒、阻尼比 0.825）更利落一点，换算自响应时间 0.38 秒、阻尼比 0.75：
 * 刚度 = (2π / 响应时间)²，阻尼 = 4π × 阻尼比 / 响应时间（质量为 1），带一点回弹，像灵动岛那样「弹」开
 */
const ISLAND_SPRING: Transition = { type: 'spring', mass: 1, stiffness: 273, damping: 25 }
// 提示默认停留时长
const ALERT_MS = 2400

// 胶囊与小圆点共用的外观：深色药丸（浅色、深色主题下都是黑色，同灵动岛），细描边让它在深色卡片上也有边界
const capsuleClass = 'relative isolate flex h-9 min-w-9 max-w-full shrink items-center overflow-hidden bg-neutral-950 text-sm font-semibold text-white ring-1 ring-white/10 transition-shadow duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'

/**
 * 顶栏标题区（灵动岛，实验性）：左侧始终是回到首页的站点链接；有活动或提示时站名收起为图标，旁边弹出一枚胶囊。
 * - 活动按优先级仲裁：第一名占胶囊，第二名（有 minimal 时）缩成旁边的小圆点；提示短暂抢占胶囊，显示完回到原来的活动
 * - 点按胶囊：有面板时展开面板（后台可关闭），否则执行活动的 onPress；正在显示的提示被点按时立即结束
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
  const { activities, alerts } = useIslandState()
  const visible = settings.enabled ? activities.filter(activity => settings[activity.feature]) : []
  const primary = visible[0]
  const secondary = visible.slice(1).find(activity => activity.minimal)
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
              />
            )
          : <SiteLink key="site" />}
        {secondary && (
          <IslandButton
            key={`dot-${secondary.id}`}
            shape="dot"
            activity={secondary}
            expandable={settings.expand}
            open={openId === secondary.id}
            onOpenChange={open => setOpenId(open ? secondary.id : null)}
          />
        )}
      </AnimatePresence>
      {/* 提示的读屏播报：只在提示出现时写入文本 */}
      <span role="status" aria-live="polite" className="sr-only">
        {alert ? (alert.announce ?? alert.text) : ''}
      </span>
    </div>
  )
}

/**
 * 回到首页的站点链接（图标 + 站名，窄屏只显示站名）。岛上有内容时整个让位给胶囊，
 * 此时回到首页的入口为主菜单的「首页」（移动端在侧边菜单里）
 */
function SiteLink({ ref }: { ref?: React.Ref<HTMLDivElement> }) {
  const { siteInfo } = useSiteInfo()
  const name = siteInfo.metadata.name
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, filter: 'blur(4px)' }}
      transition={{ duration: 0.2 }}
      className="flex min-w-0 shrink"
    >
      <Link
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

/**
 * 胶囊（shape="capsule"）或第二活动的小圆点（shape="dot"）。胶囊显示提示或活动内容，内容切换时新旧内容交叉淡入、胶囊宽度随之形变；
 * 有面板时为面板的触发按钮
 */
function IslandButton({ ref, shape, activity, alert, expandable, open, onOpenChange }: {
  // AnimatePresence 的 popLayout 需要拿到元素测量位置；有面板时由 PopoverTrigger 合并到同一个按钮上
  ref?: React.Ref<HTMLButtonElement>
  shape: 'capsule' | 'dot'
  activity?: IslandActivity
  alert?: QueuedIslandAlert
  expandable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const panel = expandable ? activity?.panel : undefined
  const isDot = shape === 'dot'
  const content: ReactNode = alert
    ? <AlertContent alert={alert} />
    : isDot ? activity?.minimal : activity?.compact
  const contentKey = alert ? `alert:${alert.key}:${alert.count}` : `activity:${activity?.id}`
  const label = alert ? alert.text : activity?.label
  const glow = !alert && !isDot ? activity?.glow : null

  const button = (
    <motion.button
      ref={ref}
      type="button"
      layout
      data-island-capsule={isDot ? undefined : ''}
      aria-label={label}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={ISLAND_SPRING}
      onClick={(event) => {
        if (alert) {
          finishIslandAlert(alert.seq)
          if (alert.onPress) {
            // 提示自带操作时不展开面板
            event.preventDefault()
            alert.onPress()
          }
          return
        }
        if (!panel)
          activity?.onPress?.()
      }}
      // 圆角写在 style 里，布局动画缩放时由 motion 修正，保持药丸形状
      style={{
        borderRadius: 999,
        // 胶囊从站名的左端长出来，小圆点从中心弹出
        originX: isDot ? 0.5 : 0,
        boxShadow: glow ? `0 0 0 1.5px ${glow}, 0 0 18px 2px color-mix(in oklab, ${glow} 55%, transparent)` : undefined,
      }}
      // 辉光只改颜色，不改胶囊大小（音乐相关的变化都不让岛的尺寸跟着起伏）
      // 胶囊左缘与站点图标对齐（同站点链接的内边距）
      className={cn(capsuleClass, isDot ? 'size-9 shrink-0 justify-center' : 'ml-2 sm:ml-3')}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={contentKey}
          layout="position"
          aria-hidden
          initial={{ opacity: 0, filter: 'blur(6px)', scale: 0.92 }}
          animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
          exit={{ opacity: 0, filter: 'blur(6px)', scale: 0.92 }}
          transition={{ duration: 0.22 }}
          // 两端元素与端头半圆同心（各留 6px），比例见 island-parts.tsx
          className={cn('flex h-full min-w-0 items-center', isDot ? 'justify-center' : 'gap-1.5 px-1.5')}
        >
          {content}
        </motion.span>
      </AnimatePresence>
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
        // 面板从胶囊处「长」出来：以触发处为原点放大，默认深色与胶囊一致；活动可换成别处弹层的外观（如音乐用悬浮播放器的弹层）
        className={activity?.panelClassName ?? 'w-[min(22rem,calc(100vw-1.5rem))] rounded-3xl border-0 bg-neutral-950 p-4 text-white shadow-2xl ring-1 ring-white/10 data-[state=open]:duration-300 data-[state=open]:zoom-in-75'}
        style={activity?.panelStyle}
      >
        {panel}
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
