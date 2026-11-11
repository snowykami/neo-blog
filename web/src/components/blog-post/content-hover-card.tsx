'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { HOVER_CLOSE_DELAY, HOVER_OPEN_DELAY, TOUCH_AUTO_CLOSE } from '@/components/common/hover-popover'
import { LinkPreviewCard } from '@/components/common/link-preview-card'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { ANNOTATION_ATTR } from '@/components/tiptap-extension/annotation-constants'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { getVisibleElementById } from '@/utils/client/dom'
import './content-hover-card.scss'

type HoverTarget
  = | { el: HTMLElement, kind: 'link', url: string }
    | { el: HTMLElement, kind: 'annotation', term: string, note: string }

// 交互时序与 HoverPopover 保持一致
const OPEN_DELAY = HOVER_OPEN_DELAY
const CLOSE_DELAY = HOVER_CLOSE_DELAY

/**
 * 正文悬停卡片：整篇内容共用一个卡片，通过事件委托在外链与注释词语上显示
 * - 外链：显示链接预览
 * - 注释：大字显示词语本身，小字显示注释
 * 触摸设备没有悬停：点一下外链或注释显示卡片（外链通过卡片中的按钮打开），
 * 再点一次、点击其他地方或 10 秒无操作后关闭
 * 键盘：Tab 聚焦外链或注释时显示卡片（与悬停相同的延迟），注释可按 Enter / 空格切换，Esc 或移走焦点关闭
 */
export function ContentHoverCard({ containerId }: { containerId: string }) {
  const [target, setTarget] = useState<HoverTarget | null>(null)
  const targetRef = useRef<HoverTarget | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const autoCloseTimer = useRef<number | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const cardId = useId()

  // 触摸打开的卡片在无操作一段时间后关闭，触摸卡片会重新计时
  const scheduleAutoClose = () => {
    window.clearTimeout(autoCloseTimer.current)
    autoCloseTimer.current = window.setTimeout(setTarget, TOUCH_AUTO_CLOSE, null)
  }

  useEffect(() => {
    targetRef.current = target
  }, [target])

  useEffect(() => {
    const container = getVisibleElementById(containerId)
    if (!container)
      return

    const resolve = (node: EventTarget | null): HoverTarget | null => {
      const el = (node as Element | null)?.closest?.(`a[href], [${ANNOTATION_ATTR}]`) as HTMLElement | null
      // 组件岛内的链接（仓库卡、单曲卡等）不显示预览
      if (!el || !container.contains(el) || el.closest(COMPONENT_ROOT_SELECTOR))
        return null
      if (el.hasAttribute(ANNOTATION_ATTR)) {
        const note = el.getAttribute(ANNOTATION_ATTR)?.trim()
        return note ? { el, kind: 'annotation', term: el.textContent?.trim() ?? '', note } : null
      }
      // 仅外链显示预览，站内链接不显示
      const url = (el as HTMLAnchorElement).href
      try {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === window.location.origin)
          return null
      }
      catch {
        return null
      }
      return { el, kind: 'link', url }
    }

    // 注释词语是普通 span：补上 tabindex 与 role，让键盘和读屏可以到达（只在前台渲染时加，不改存储内容）
    container.querySelectorAll<HTMLElement>(`[${ANNOTATION_ATTR}]`).forEach((el) => {
      if (resolve(el)?.el !== el)
        return
      el.tabIndex = 0
      el.setAttribute('role', 'button')
      el.setAttribute('aria-expanded', 'false')
    })

    const show = (next: HoverTarget) => {
      window.clearTimeout(closeTimer.current)
      if (targetRef.current?.el === next.el)
        return
      window.clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(setTarget, OPEN_DELAY, next)
    }

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse')
        return
      const next = resolve(event.target)
      if (next)
        show(next)
    }

    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse')
        return
      const from = resolve(event.target)
      // 在同一元素内部移动不关闭
      if (!from || from.el.contains(event.relatedTarget as Node | null))
        return
      window.clearTimeout(openTimer.current)
      closeTimer.current = window.setTimeout(setTarget, CLOSE_DELAY, null)
    }

    // 部分移动浏览器（如 iOS Safari）的 click 事件不带 pointerType，在 pointerdown 时记录输入方式
    let lastPointerType = ''
    const onPointerDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType
    }

    const onClick = (event: MouseEvent) => {
      // 鼠标由悬停处理；键盘触发的 click（detail 为 0）保持原有行为
      if (event.detail === 0 || !['touch', 'pen'].includes(lastPointerType))
        return
      const next = resolve(event.target)
      if (!next)
        return
      // 外链点一下先展示卡片，不直接跳转
      event.preventDefault()
      if (targetRef.current?.el === next.el) {
        setTarget(null)
        return
      }
      setTarget(next)
      scheduleAutoClose()
    }

    // 键盘聚焦（:focus-visible）时与悬停一样延迟显示；鼠标点击产生的聚焦交给悬停处理
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as HTMLElement
      if (!el.matches?.(':focus-visible'))
        return
      const next = resolve(el)
      if (next?.el === el)
        show(next)
    }

    const onFocusOut = (event: FocusEvent) => {
      const from = resolve(event.target)
      if (!from || from.el !== event.target)
        return
      window.clearTimeout(openTimer.current)
      // 焦点移入卡片（如链接预览中的按钮）时不关闭
      if (targetRef.current?.el === from.el && !cardRef.current?.contains(event.relatedTarget as Node | null))
        setTarget(null)
    }

    // 注释按 Enter / 空格立即切换卡片；外链的 Enter 保持默认跳转
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ')
        return
      const next = resolve(event.target)
      if (next?.kind !== 'annotation' || next.el !== event.target)
        return
      event.preventDefault()
      window.clearTimeout(openTimer.current)
      setTarget(targetRef.current?.el === next.el ? null : next)
    }

    container.addEventListener('pointerover', onPointerOver)
    container.addEventListener('pointerout', onPointerOut)
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('click', onClick)
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('pointerover', onPointerOver)
      container.removeEventListener('pointerout', onPointerOut)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('click', onClick)
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
      container.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(autoCloseTimer.current)
    }
  }, [containerId])

  // 卡片关闭后不再需要自动关闭计时
  useEffect(() => {
    if (!target)
      window.clearTimeout(autoCloseTimer.current)
  }, [target])

  // 同步注释的展开状态，并让读屏把卡片内容作为当前元素的描述
  useEffect(() => {
    if (!target)
      return
    const { el } = target
    el.setAttribute('aria-describedby', cardId)
    if (target.kind === 'annotation')
      el.setAttribute('aria-expanded', 'true')
    return () => {
      el.removeAttribute('aria-describedby')
      if (target.kind === 'annotation')
        el.setAttribute('aria-expanded', 'false')
    }
  }, [target, cardId])

  // 以悬停的正文元素作为卡片定位锚点
  const virtualRef = useMemo(() => (target ? { current: target.el } : null), [target])

  return (
    <Popover open={!!target} onOpenChange={open => !open && setTarget(null)}>
      {virtualRef && <PopoverAnchor virtualRef={virtualRef} />}
      {target && (
        <PopoverContent
          ref={cardRef}
          id={cardId}
          className={target.kind === 'link' ? 'w-80 p-0' : 'w-auto max-w-80 p-0'}
          align="start"
          sideOffset={8}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          // 再次点击同一个外链/注释时交给 onClick 切换关闭，点击其他地方则关闭
          onInteractOutside={(e) => {
            if (target.el.contains(e.target as Node))
              e.preventDefault()
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse')
              window.clearTimeout(closeTimer.current)
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse')
              closeTimer.current = window.setTimeout(setTarget, CLOSE_DELAY, null)
          }}
          // 触摸卡片时重新计时，阅读期间不会自动关闭
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse')
              scheduleAutoClose()
          }}
        >
          {target.kind === 'link'
            ? <LinkPreviewCard url={target.url} onOpen={() => setTarget(null)} />
            : (
                <div className="grid gap-1 p-4">
                  <div className="text-lg font-semibold leading-snug">{target.term}</div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{target.note}</p>
                </div>
              )}
        </PopoverContent>
      )}
    </Popover>
  )
}
