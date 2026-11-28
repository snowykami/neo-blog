'use client'

import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import type { TocHeading } from '@/models/toc'
import { TextSelection } from '@tiptap/pm/state'
import { ListTreeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { TocCard } from '@/components/blog-post/toc-card'
import { AI_PREVIEW_META } from '@/components/tiptap-extension/ai-write-extension'
import { INLINE_MATH_NODE } from '@/components/tiptap-node/math-node/math-extension'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/floating'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isElementRendered } from '@/utils/client/dom'

const HEADING_DEBOUNCE_MS = 120
const FOCUS_MODE_SCROLL_PADDING = 56
const DEFAULT_NORMAL_SCROLL_OFFSET = 128
const WIDE_CONTAINER_REM = 84
const TOC_SELECT_META = 'neoEditorTocSelect'

export interface RawEditorHeading {
  pos: number
  nodeSize: number
  level: number
  text: string
}

const docHeadingCache = new WeakMap<PMNode, RawEditorHeading[]>()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 提取单个标题节点的纯文本（对齐前台 heading-toc.ts：保留行内公式 LaTeX 源码，软换行转空格，忽略行内图标）
 */
export function extractHeadingText(heading: PMNode): string {
  let raw = ''
  heading.descendants((child) => {
    if (child.isText)
      raw += child.text ?? ''
    else if (child.type.name === INLINE_MATH_NODE)
      raw += String(child.attrs.latex ?? '')
    else if (child.type.name === 'hardBreak')
      raw += ' '
    return false
  })
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * 从 ProseMirror 文档树提取 h1–h4 标题目录（与前台 heading-toc.ts 提取层级和过滤规则对齐）：
 * 对普通段落、代码块、组件岛及原子媒体块直接剪枝不下钻，长文档扫描耗时 < 0.05ms，并按不可变 doc 引用缓存
 */
export function extractEditorHeadings(doc: PMNode): RawEditorHeading[] {
  const cached = docHeadingCache.get(doc)
  if (cached !== undefined)
    return cached

  const result: RawEditorHeading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level)
      if (level >= 1 && level <= 4) {
        const text = extractHeadingText(node)
        if (text)
          result.push({ pos, nodeSize: node.nodeSize, level, text })
      }
      return false
    }
    if (node.isTextblock || node.isAtom || node.type.spec.code || node.type.name === 'componentBlock')
      return false
    return true
  })

  docHeadingCache.set(doc, result)
  return result
}

export function toTocHeadings(raw: readonly RawEditorHeading[]): TocHeading[] {
  return raw.map((item, index) => ({
    id: `editor-heading-${index}`,
    level: item.level,
    text: item.text,
  }))
}

/**
 * 判断渲染用标题结构（数量、层级、文本）是否完全未变：
 * 在正文段落打字导致后续标题 pos 偏移时返回 true，仅静默更新位置引用，实现目录 0 次重渲染
 */
export function areHeadingsStructurallyEqual(
  prev: readonly TocHeading[],
  nextRaw: readonly RawEditorHeading[],
): boolean {
  if (prev.length !== nextRaw.length)
    return false
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].level !== nextRaw[i].level || prev[i].text !== nextRaw[i].text)
      return false
  }
  return true
}

/**
 * 在 120ms 防抖窗口内发生点击时安全解析实时标题节点，防止使用已过期的旧 pos 触发 RangeError 或跳错块
 */
export function resolveLiveEditorHeading(
  doc: PMNode,
  index: number,
  cached?: RawEditorHeading,
): RawEditorHeading | null {
  if (cached && cached.pos >= 0 && cached.pos < doc.content.size) {
    const node = doc.nodeAt(cached.pos)
    if (
      node
      && node.type.name === 'heading'
      && Number(node.attrs.level) === cached.level
      && extractHeadingText(node) === cached.text
    ) {
      return { pos: cached.pos, nodeSize: node.nodeSize, level: cached.level, text: cached.text }
    }
  }
  const live = extractEditorHeadings(doc)
  if (live.length === 0)
    return null
  const clamped = Math.max(0, Math.min(index, live.length - 1))
  return live[clamped] ?? null
}

function isDocResetTransaction(transaction: Pick<Transaction, 'getMeta'>): boolean {
  return transaction.getMeta('addToHistory') === false && !transaction.getMeta(AI_PREVIEW_META)
}

function resolveHeadingElement(editor: Editor, pos: number): HTMLElement | null {
  if (editor.isDestroyed)
    return null
  const direct = editor.view.nodeDOM(pos)
  if (direct instanceof HTMLElement)
    return direct
  const safePos = Math.min(pos + 1, editor.state.doc.content.size)
  try {
    const domAt = editor.view.domAtPos(safePos)
    const base = domAt.node instanceof HTMLElement ? domAt.node : domAt.node.parentElement
    return base?.closest<HTMLElement>('h1, h2, h3, h4') ?? null
  }
  catch {
    return null
  }
}

/**
 * 计算滚动定位与越线判定的吸顶稳态阈值：
 * 普通模式读取编辑器直接子级吸顶栏自身的 `sticky top + offsetHeight`，不受顶部尚未滚走的 SiteHeader 或接管横幅影响
 */
function getEditorScrollThreshold(shellEl: HTMLElement | null, focusMode: boolean): number {
  if (focusMode && shellEl) {
    return shellEl.getBoundingClientRect().top + FOCUS_MODE_SCROLL_PADDING
  }
  if (shellEl) {
    const stickyHeaders = shellEl.querySelectorAll<HTMLElement>(':scope > header, :scope > [data-editor-sticky-header]')
    let steadyBottom = 0
    stickyHeaders.forEach((el) => {
      if (!isElementRendered(el))
        return
      const stickyTop = Number.parseFloat(getComputedStyle(el).top)
      const top = Number.isFinite(stickyTop) ? stickyTop : 0
      steadyBottom = Math.max(steadyBottom, top + el.offsetHeight)
    })
    if (steadyBottom > 0)
      return steadyBottom + 20
  }
  return DEFAULT_NORMAL_SCROLL_OFFSET
}

export interface EditorTocController {
  headings: TocHeading[]
  activeId: string | null
  selectHeading: (index: number) => void
}

/**
 * 编辑器目录状态控制器（宽屏常驻卡片与窄屏浮动弹层共用一份状态与事件订阅）
 */
export function useEditorToc(
  editor: Editor,
  shellRef: React.RefObject<HTMLElement | null>,
  focusMode: boolean,
): EditorTocController {
  const initialRaw = React.useMemo(() => extractEditorHeadings(editor.state.doc), [editor])
  const rawRef = React.useRef<RawEditorHeading[]>(initialRaw)
  const [headings, setHeadings] = React.useState<TocHeading[]>(() => toTocHeadings(initialRaw))
  const [activeIndex, setActiveIndex] = React.useState(0)

  const lockedRef = React.useRef(false)
  const unlockTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const resetLock = React.useCallback(() => {
    clearTimeout(unlockTimerRef.current)
    unlockTimerRef.current = undefined
    lockedRef.current = false
  }, [])

  React.useEffect(() => resetLock, [resetLock])

  // 1. 订阅文档变更提取标题（忽略 AI 流式预览，组字态延后到 compositionend，光标视口检测合并进 rAF 防强制同步回流）
  React.useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let cursorRafId = 0
    let pendingAfterComposition = false

    const syncHeadings = () => {
      if (editor.isDestroyed)
        return
      const nextRaw = extractEditorHeadings(editor.state.doc)
      rawRef.current = nextRaw
      setHeadings(prev => (areHeadingsStructurallyEqual(prev, nextRaw) ? prev : toTocHeadings(nextRaw)))
    }

    const syncCursorChapter = () => {
      cursorRafId = 0
      if (editor.isDestroyed || !editor.isFocused)
        return
      const live = extractEditorHeadings(editor.state.doc)
      rawRef.current = live
      if (live.length < 2)
        return
      const from = editor.state.selection.from
      let cursorIdx = -1
      for (let i = 0; i < live.length; i++) {
        if (live[i].pos <= from)
          cursorIdx = i
        else
          break
      }
      if (cursorIdx < 0)
        return
      const headingEl = resolveHeadingElement(editor, live[cursorIdx].pos)
      if (!headingEl)
        return
      const shellEl = shellRef.current
      const threshold = getEditorScrollThreshold(shellEl, focusMode)
      const viewportBottom = focusMode && shellEl
        ? shellEl.getBoundingClientRect().bottom
        : window.innerHeight
      const rect = headingEl.getBoundingClientRect()
      if (rect.bottom > threshold - 8 && rect.top < viewportBottom) {
        setActiveIndex(prev => (prev === cursorIdx ? prev : cursorIdx))
        lockedRef.current = true
        clearTimeout(unlockTimerRef.current)
        unlockTimerRef.current = setTimeout(() => {
          lockedRef.current = false
        }, 250)
      }
    }

    syncHeadings()

    const onCompositionEnd = () => {
      if (!pendingAfterComposition)
        return
      pendingAfterComposition = false
      syncHeadings()
    }

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(AI_PREVIEW_META))
        return

      if (
        !transaction.getMeta(TOC_SELECT_META)
        && (transaction.selectionSet || transaction.docChanged)
        && editor.isFocused
        && !editor.isDestroyed
      ) {
        if (cursorRafId === 0)
          cursorRafId = requestAnimationFrame(syncCursorChapter)
      }

      if (!transaction.docChanged)
        return

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }

      if (isDocResetTransaction(transaction)) {
        pendingAfterComposition = false
        syncHeadings()
        return
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (editor.isDestroyed)
          return
        if (editor.view.composing) {
          pendingAfterComposition = true
          return
        }
        syncHeadings()
      }, HEADING_DEBOUNCE_MS)
    }

    const dom = editor.view.dom
    editor.on('transaction', handleTransaction)
    dom.addEventListener('compositionend', onCompositionEnd)
    return () => {
      if (debounceTimer !== null)
        clearTimeout(debounceTimer)
      if (cursorRafId !== 0)
        cancelAnimationFrame(cursorRafId)
      editor.off('transaction', handleTransaction)
      dom.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [editor, focusMode, shellRef])

  const hasToc = headings.length >= 2

  const computeScrollActiveIndex = React.useCallback(() => {
    if (editor.isDestroyed)
      return
    // 直接从当前 doc 的 WeakMap 缓存取最新标题位置，避免 120ms 防抖或组字期间读取过期的旧 pos
    const list = extractEditorHeadings(editor.state.doc)
    rawRef.current = list
    if (list.length < 2)
      return

    const shellEl = shellRef.current
    const threshold = getEditorScrollThreshold(shellEl, focusMode)
    const viewportBottom = focusMode && shellEl
      ? shellEl.getBoundingClientRect().bottom
      : window.innerHeight

    let atBottom = false
    if (focusMode && shellEl) {
      atBottom = shellEl.scrollTop > 0 && shellEl.scrollTop + shellEl.clientHeight >= shellEl.scrollHeight - 2
    }
    else {
      const docEl = document.documentElement
      atBottom = window.scrollY > 0 && window.scrollY + window.innerHeight >= docEl.scrollHeight - 2
    }

    let current = 0
    let lastVisible = -1
    for (let i = 0; i < list.length; i++) {
      const el = resolveHeadingElement(editor, list[i].pos)
      if (!el)
        continue
      const rect = el.getBoundingClientRect()
      if (rect.top < viewportBottom - 16)
        lastVisible = i
      if (rect.top - threshold - 1 <= 0)
        current = i
    }

    if (atBottom && lastVisible > current)
      current = lastVisible

    setActiveIndex(prev => (prev === current ? prev : current))
  }, [editor, focusMode, shellRef])

  // 2. 订阅当前滚动容器（普通模式 window / 专注模式 .neo-editor-shell）及正文尺寸变化更新当前章节
  React.useEffect(() => {
    if (!hasToc || editor.isDestroyed)
      return

    const shellEl = shellRef.current
    const scrollTarget: HTMLElement | Window = focusMode && shellEl ? shellEl : window
    let rafId = 0

    const scheduleUpdate = () => {
      if (lockedRef.current) {
        clearTimeout(unlockTimerRef.current)
        unlockTimerRef.current = setTimeout(() => {
          lockedRef.current = false
        }, 150)
        return
      }
      if (rafId !== 0)
        return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        computeScrollActiveIndex()
      })
    }

    const unlock = () => {
      resetLock()
    }

    computeScrollActiveIndex()
    scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    scrollTarget.addEventListener('wheel', unlock, { passive: true })
    scrollTarget.addEventListener('touchstart', unlock, { passive: true })

    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(editor.view.dom)

    return () => {
      if (rafId !== 0)
        cancelAnimationFrame(rafId)
      scrollTarget.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      scrollTarget.removeEventListener('wheel', unlock)
      scrollTarget.removeEventListener('touchstart', unlock)
      resizeObserver.disconnect()
      resetLock()
    }
  }, [computeScrollActiveIndex, editor, focusMode, hasToc, resetLock, shellRef])

  // 标题列表重排/恢复版本但仍保持 >= 2 项时，若未锁定则在下一帧校准高亮项
  React.useEffect(() => {
    if (!hasToc || lockedRef.current)
      return
    const id = requestAnimationFrame(() => {
      if (!lockedRef.current)
        computeScrollActiveIndex()
    })
    return () => cancelAnimationFrame(id)
  }, [computeScrollActiveIndex, hasToc, headings])

  const clampedIndex = headings.length > 0 ? Math.min(activeIndex, headings.length - 1) : 0
  const activeId = headings[clampedIndex]?.id ?? null

  const selectHeading = React.useCallback((index: number) => {
    if (editor.isDestroyed)
      return
    const target = resolveLiveEditorHeading(editor.state.doc, index, rawRef.current[index])
    if (!target)
      return

    const liveList = extractEditorHeadings(editor.state.doc)
    rawRef.current = liveList
    const resolvedIdx = liveList.findIndex(item => item.pos === target.pos)
    const nextIdx = resolvedIdx >= 0 ? resolvedIdx : Math.min(index, Math.max(0, headings.length - 1))

    setActiveIndex(nextIdx)
    lockedRef.current = true
    clearTimeout(unlockTimerRef.current)
    unlockTimerRef.current = setTimeout(() => {
      lockedRef.current = false
    }, 350)

    // 先静默设置标题末尾选区（带 TOC_SELECT_META）并以 preventScroll 聚焦，严防原生 focus() 瞬移打断后续平滑滚动
    if (editor.isEditable) {
      try {
        const endPos = Math.max(0, Math.min(target.pos + target.nodeSize - 1, editor.state.doc.content.size))
        const sel = TextSelection.near(editor.state.doc.resolve(endPos), -1)
        const tr = editor.state.tr
          .setSelection(sel)
          .setMeta('addToHistory', false)
          .setMeta(TOC_SELECT_META, true)
        editor.view.dispatch(tr)
        editor.view.dom.focus({ preventScroll: true })
      }
      catch {
        // 极端情况下选区失败不阻断滚动
      }
    }

    const headingEl = resolveHeadingElement(editor, target.pos)
    if (!headingEl)
      return

    const shellEl = shellRef.current
    const threshold = getEditorScrollThreshold(shellEl, focusMode)
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth'

    if (focusMode && shellEl) {
      const targetTop = shellEl.scrollTop + headingEl.getBoundingClientRect().top - threshold
      shellEl.scrollTo({ top: Math.max(0, targetTop), behavior })
    }
    else {
      const targetTop = window.scrollY + headingEl.getBoundingClientRect().top - threshold
      window.scrollTo({ top: Math.max(0, targetTop), behavior })
    }
  }, [editor, focusMode, headings.length, shellRef])

  return { headings, activeId, selectHeading }
}

/**
 * 宽屏（画布容器 >= 84rem）右侧常驻目录卡片；专注模式下默认半透明弱化，悬停或键盘聚焦时恢复完全清晰
 */
export function EditorTocRail({
  toc,
  focusMode,
  readOnly,
}: {
  toc: EditorTocController
  focusMode: boolean
  readOnly: boolean
}) {
  const commonT = useTranslations('Common')
  const label = commonT('table_of_contents')

  if (toc.headings.length < 2)
    return null

  const stickyClass = focusMode
    ? 'top-14'
    : readOnly
      ? 'top-[4.5rem]'
      : 'top-[7.5rem]'

  const navMaxH = focusMode
    ? 'max-h-[calc(100dvh-7.5rem)]'
    : readOnly
      ? 'max-h-[calc(100dvh-10rem)]'
      : 'max-h-[calc(100dvh-13rem)]'

  return (
    <aside
      className={cn(
        'hidden min-w-0 @[84rem]/editor:sticky @[84rem]/editor:block',
        stickyClass,
      )}
    >
      <div
        className={cn(
          'w-full max-w-64 transition-opacity duration-200',
          focusMode && 'opacity-35 hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <TocCard
          title={label}
          ariaLabel={label}
          headings={toc.headings}
          activeId={toc.activeId}
          navClassName={navMaxH}
          onSelect={(_heading, index) => toc.selectHeading(index)}
        />
      </div>
    </aside>
  )
}

function isContainerWide(el: HTMLElement | null): boolean {
  if (!el)
    return false
  const rootRem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return el.clientWidth >= WIDE_CONTAINER_REM * rootRem
}

/**
 * 中窄屏（画布容器 < 84rem）右下角轻量目录浮层入口：
 * 位于 `@container/editor` 外部，保证 `position: fixed` 锚定真实浏览器视口，并在切回宽屏常驻时自动收起卸载
 */
export function EditorTocFloating({
  toc,
  containerRef,
  focusMode,
}: {
  toc: EditorTocController
  containerRef: React.RefObject<HTMLElement | null>
  focusMode: boolean
}) {
  const commonT = useTranslations('Common')
  const label = commonT('table_of_contents')
  const [open, setOpen] = React.useState(false)
  const [isWide, setIsWide] = React.useState(false)
  const closingToEditorRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el)
      return
    const update = () => {
      const wide = isContainerWide(el)
      setIsWide(prev => (prev === wide ? prev : wide))
      if (wide)
        setOpen(false)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])

  React.useEffect(() => {
    if (toc.headings.length < 2 && open)
      setOpen(false)
  }, [open, toc.headings.length])

  if (isWide || toc.headings.length < 2)
    return null

  return (
    <div
      className={cn(
        'fixed right-4 bottom-11 z-30',
        focusMode && !open && 'opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100',
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={label}
            title={label}
            className="h-9 gap-1.5 rounded-full bg-card/95 px-3 shadow-md backdrop-blur-md"
          >
            <ListTreeIcon aria-hidden className="size-4 text-primary" />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          {...{ [EDITOR_FLOATING_ATTR]: '' }}
          side="top"
          align="end"
          sideOffset={8}
          onCloseAutoFocus={(event) => {
            if (closingToEditorRef.current) {
              closingToEditorRef.current = false
              event.preventDefault()
            }
          }}
          className="w-68 max-w-[calc(100vw-2rem)] rounded-2xl border-0 bg-transparent p-0 shadow-none"
        >
          <TocCard
            title={label}
            ariaLabel={label}
            headings={toc.headings}
            activeId={toc.activeId}
            navClassName="max-h-[min(24rem,60dvh)]"
            className="border shadow-xl"
            onSelect={(_heading, index) => {
              closingToEditorRef.current = true
              setOpen(false)
              toc.selectHeading(index)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
