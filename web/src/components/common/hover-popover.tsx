'use client'

import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

// 悬停/点击弹窗的统一交互时序，正文卡片（ContentHoverCard）同样使用
export const HOVER_OPEN_DELAY = 250
export const HOVER_CLOSE_DELAY = 200
// 触摸点开的弹窗无操作时自动关闭
export const TOUCH_AUTO_CLOSE = 10_000

/**
 * 悬停/点击弹窗：鼠标悬停显示、移开关闭（可移入弹窗内）；
 * 触摸设备点一下显示，再点一次、点击其他地方或 10 秒无操作后关闭；
 * 键盘可 Tab 聚焦触发元素，聚焦时延迟显示，Enter / 空格切换，Esc 或移走焦点关闭
 */
export function HoverPopover({
  content,
  children,
  contentClassName,
  align = 'start',
}: {
  content: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const autoCloseTimer = useRef<number | undefined>(undefined)
  // 部分移动浏览器的 click 事件不带 pointerType，在 pointerdown 时记录输入方式
  const lastPointerType = useRef('')
  // 由键盘打开时，焦点离开即关闭；指针打开的仍按悬停 / 点击规则关闭
  const openedByKeyboard = useRef(false)

  useEffect(() => () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    window.clearTimeout(autoCloseTimer.current)
  }, [])

  // 弹窗关闭后不再需要自动关闭计时
  useEffect(() => {
    if (!open)
      window.clearTimeout(autoCloseTimer.current)
  }, [open])

  const scheduleOpen = () => {
    window.clearTimeout(closeTimer.current)
    window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(setOpen, HOVER_OPEN_DELAY, true)
  }
  const scheduleClose = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(setOpen, HOVER_CLOSE_DELAY, false)
  }
  const scheduleAutoClose = () => {
    window.clearTimeout(autoCloseTimer.current)
    autoCloseTimer.current = window.setTimeout(setOpen, TOUCH_AUTO_CLOSE, false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          ref={triggerRef}
          className="inline-flex cursor-default rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          tabIndex={0}
          role="button"
          aria-expanded={open}
          onFocus={(e) => {
            // 只响应键盘聚焦，鼠标点击产生的聚焦交给悬停处理
            if (!e.currentTarget.matches(':focus-visible'))
              return
            openedByKeyboard.current = true
            scheduleOpen()
          }}
          onBlur={() => {
            if (!openedByKeyboard.current)
              return
            openedByKeyboard.current = false
            window.clearTimeout(openTimer.current)
            setOpen(false)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ')
              return
            e.preventDefault()
            window.clearTimeout(openTimer.current)
            openedByKeyboard.current = true
            setOpen(!open)
          }}
          onPointerDown={(e) => {
            lastPointerType.current = e.pointerType
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') {
              openedByKeyboard.current = false
              scheduleOpen()
            }
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse')
              scheduleClose()
          }}
          onClick={(e) => {
            // 鼠标由悬停处理；键盘触发的 click（detail 为 0）忽略
            if (e.detail === 0 || !['touch', 'pen'].includes(lastPointerType.current))
              return
            if (open) {
              setOpen(false)
              return
            }
            setOpen(true)
            scheduleAutoClose()
          }}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align={align}
        sideOffset={6}
        className={contentClassName}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        // 再次点击触发元素时交给 onClick 切换关闭，点击其他地方则关闭
        onInteractOutside={(e) => {
          if (triggerRef.current?.contains(e.target as Node))
            e.preventDefault()
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse')
            window.clearTimeout(closeTimer.current)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse')
            scheduleClose()
        }}
        // 触摸弹窗时重新计时，阅读期间不会自动关闭
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse')
            scheduleAutoClose()
        }}
      >
        {content}
      </PopoverContent>
    </Popover>
  )
}
