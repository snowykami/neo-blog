'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LinkPreviewCard } from '@/components/common/link-preview-card'
import { ANNOTATION_ATTR } from '@/components/tiptap-extension/annotation-constants'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import './content-hover-card.scss'

type HoverTarget
  = | { el: HTMLElement, kind: 'link', url: string }
    | { el: HTMLElement, kind: 'annotation', term: string, note: string }

const OPEN_DELAY = 250
const CLOSE_DELAY = 200

/**
 * 正文悬停卡片：整篇内容共用一个卡片，通过事件委托在外链与注释词语上显示
 * - 外链：显示链接预览
 * - 注释：大字显示词语本身，小字显示注释
 * 触摸设备没有悬停，点击注释词语时显示
 */
export function ContentHoverCard({ containerId }: { containerId: string }) {
  const [target, setTarget] = useState<HoverTarget | null>(null)
  const targetRef = useRef<HoverTarget | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    targetRef.current = target
  }, [target])

  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return

    const resolve = (node: EventTarget | null): HoverTarget | null => {
      const el = (node as Element | null)?.closest?.(`a[href], [${ANNOTATION_ATTR}]`) as HTMLElement | null
      if (!el || !container.contains(el))
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

    const show = (next: HoverTarget) => {
      window.clearTimeout(closeTimer.current)
      if (targetRef.current?.el === next.el)
        return
      window.clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(() => setTarget(next), OPEN_DELAY)
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
      closeTimer.current = window.setTimeout(() => setTarget(null), CLOSE_DELAY)
    }

    const onClick = (event: MouseEvent) => {
      // 鼠标由悬停处理，这里只处理触摸/笔点击注释
      if ((event as PointerEvent).pointerType === 'mouse')
        return
      const next = resolve(event.target)
      if (next?.kind !== 'annotation')
        return
      setTarget(prev => (prev?.el === next.el ? null : next))
    }

    container.addEventListener('pointerover', onPointerOver)
    container.addEventListener('pointerout', onPointerOut)
    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('pointerover', onPointerOver)
      container.removeEventListener('pointerout', onPointerOut)
      container.removeEventListener('click', onClick)
      window.clearTimeout(openTimer.current)
      window.clearTimeout(closeTimer.current)
    }
  }, [containerId])

  // 以悬停的正文元素作为卡片定位锚点
  const virtualRef = useMemo(() => (target ? { current: target.el } : null), [target])

  return (
    <Popover open={!!target} onOpenChange={open => !open && setTarget(null)}>
      {virtualRef && <PopoverAnchor virtualRef={virtualRef} />}
      {target && (
        <PopoverContent
          className={target.kind === 'link' ? 'w-80 p-0' : 'w-auto max-w-80 p-0'}
          align="start"
          sideOffset={8}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          // 再次点击同一个注释词语时交给 onClick 切换关闭
          onInteractOutside={(e) => {
            if (target.el.contains(e.target as Node))
              e.preventDefault()
          }}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={() => {
            closeTimer.current = window.setTimeout(() => setTarget(null), CLOSE_DELAY)
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
