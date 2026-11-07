'use client'

import type { Editor } from '@tiptap/react'
import type { IconCatalog, IconCatalogEntry } from '@/lib/inline-icon/catalog'
import { TextSelection } from '@tiptap/pm/state'
import { SearchIcon, ShapesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { isInlineIconNode } from '@/components/tiptap-node/inline-icon-node'
import { EDITOR_FLOATING_ATTR, useSelectionAnchor } from '@/components/tiptap-ui/link-popover/link-popover'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { isComposingKey } from '@/lib/ime'
import { loadIconCatalog, searchIcons } from '@/lib/inline-icon/catalog'
import { cn } from '@/lib/utils'

/** 选择器的目标：pos 为 null 时在光标处插入，否则更换该位置的图标 */
export interface InlineIconPickerTarget {
  pos: number | null
}

export interface InlineIconPickerProps {
  editor: Editor | null
  target: InlineIconPickerTarget | null
  onClose: () => void
}

const RECENT_KEY = 'editor-recent-icons'
const RECENT_LIMIT = 24
// 网格分批渲染：滚动到底部时再追加，避免一次渲染上千个图标
const PAGE_SIZE = 160
const ALL = 'all'

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string').slice(0, RECENT_LIMIT) : []
  }
  catch {
    return []
  }
}

function saveRecent(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter(item => item !== name)].slice(0, RECENT_LIMIT)))
  }
  catch {
    // 隐私模式等无法写入时忽略
  }
}

type CatalogState = { status: 'loading' } | { status: 'ready', catalog: IconCatalog } | { status: 'error' }

function useIconCatalog(enabled: boolean) {
  const [state, setState] = React.useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!enabled || state.status === 'ready')
      return
    let cancelled = false
    loadIconCatalog().then(
      (catalog) => {
        if (!cancelled)
          setState({ status: 'ready', catalog })
      },
      () => {
        if (!cancelled)
          setState({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled, attempt, state.status])
  const retry = React.useCallback(() => {
    setState({ status: 'loading' })
    setAttempt(n => n + 1)
  }, [])
  return { state, retry }
}

/**
 * 行内图标选择器：按英文名、lucide 检索词与分类名（含本地化名称）搜索，按分类浏览，记住最近使用的图标
 * 图标目录在第一次打开时才加载（lib/inline-icon/catalog.ts）
 * - 搜索框中 Enter 插入第一个结果、↓ 进入图标网格；网格中方向键移动、Enter 选择；Esc 关闭
 */
export function InlineIconPicker({ editor, target, onClose }: InlineIconPickerProps) {
  const t = useTranslations('Console.editor.icon')
  const anchor = useSelectionAnchor(editor)
  const open = target !== null && !!editor && !editor.isDestroyed
  const { state, retry } = useIconCatalog(open)
  const catalog = state.status === 'ready' ? state.catalog : null

  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState(ALL)
  const [recent, setRecent] = React.useState<string[]>([])
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [active, setActive] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  // 打开时重置：更换图标时高亮当前图标
  const [openedFor, setOpenedFor] = React.useState<InlineIconPickerTarget | null>(null)
  if (open && editor && target && openedFor !== target) {
    setOpenedFor(target)
    setQuery('')
    setCategory(ALL)
    setLimit(PAGE_SIZE)
    setRecent(readRecent())
    const node = target.pos != null ? editor.state.doc.nodeAt(target.pos) : null
    setActive(isInlineIconNode(node) ? node.attrs.name : null)
  }
  else if (!open && openedFor !== null) {
    setOpenedFor(null)
  }

  const currentName = React.useMemo(() => {
    if (!editor || target?.pos == null)
      return null
    const node = editor.state.doc.nodeAt(target.pos)
    return isInlineIconNode(node) ? (node.attrs.name as string) : null
  }, [editor, target])

  // 分类名（本地化 + 英文键）参与检索，中文等也能按分类找到图标
  const categoryLabels = React.useMemo(
    () => catalog?.categories.map(key => `${t(`categories.${key}`).toLowerCase()} ${key.replaceAll('-', ' ')}`) ?? [],
    [catalog, t],
  )

  // 检索跟随延后的关键字，输入框保持跟手（输入法组字也不会被重新渲染打断）
  const keyword = React.useDeferredValue(query).trim()
  const scope = keyword ? ALL : category
  const results = React.useMemo(() => {
    if (!catalog)
      return []
    if (keyword)
      return searchIcons(catalog, keyword, categoryLabels)
    if (scope === ALL)
      return catalog.icons
    const index = catalog.categories.indexOf(scope)
    return catalog.icons.filter(icon => icon.categories.includes(index))
  }, [catalog, keyword, scope, categoryLabels])

  const recentIcons = React.useMemo(() => {
    if (!catalog || keyword || scope !== ALL)
      return []
    const byName = new Map(catalog.icons.map(icon => [icon.name, icon]))
    return recent.map(name => byName.get(name)).filter((icon): icon is IconCatalogEntry => !!icon)
  }, [catalog, keyword, scope, recent])

  const shown = results.slice(0, limit)
  // 网格中按顺序排列的图标（最近使用在前），用于方向键移动
  const ordered = React.useMemo(() => [...recentIcons.map(icon => `recent:${icon.name}`), ...shown.map(icon => icon.name)], [recentIcons, shown])

  React.useEffect(() => {
    setLimit(PAGE_SIZE)
    gridRef.current?.scrollTo({ top: 0 })
  }, [keyword, scope])

  // 滚动到底部时追加下一批
  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || shown.length >= results.length)
      return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting))
        setLimit(n => n + PAGE_SIZE)
    }, { root: gridRef.current, rootMargin: '120px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [shown.length, results.length])

  if (!editor)
    return null

  const pick = (name: string) => {
    saveRecent(name)
    const pos = target?.pos
    if (pos != null) {
      const node = editor.state.doc.nodeAt(pos)
      if (isInlineIconNode(node)) {
        const { tr } = editor.state
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, name })
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + node.nodeSize)))
        editor.view.dispatch(tr)
      }
    }
    else {
      editor.chain().focus().insertInlineIcon(name).run()
    }
    onClose()
  }

  const focusIcon = (index: number) => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-icon-name]')
    const button = buttons?.[Math.max(0, Math.min(index, buttons.length - 1))]
    button?.focus()
    button?.scrollIntoView({ block: 'nearest' })
  }

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-icon-name]')
    if (!button || isComposingKey(event))
      return
    const index = ordered.indexOf(button.dataset.iconKey ?? '')
    const columns = gridRef.current
      ? getComputedStyle(gridRef.current.querySelector('[data-icon-grid]') ?? gridRef.current).gridTemplateColumns.split(' ').length
      : 8
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
    const move = moves[event.key]
    if (move === undefined)
      return
    event.preventDefault()
    if (move < 0 && index + move < 0 && event.key === 'ArrowUp') {
      inputRef.current?.focus()
      return
    }
    focusIcon(index + move)
  }

  const renderIcon = (icon: IconCatalogEntry, key: string) => {
    const Icon = catalog?.component(icon.name) ?? ShapesIcon
    return (
      <button
        key={key}
        type="button"
        data-icon-name={icon.name}
        data-icon-key={key}
        title={icon.name}
        aria-label={icon.name}
        aria-pressed={icon.name === currentName}
        className={cn(
          'flex aspect-square items-center justify-center rounded-md text-foreground/80 outline-none transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          icon.name === currentName && 'bg-primary/10 text-primary',
        )}
        onClick={() => pick(icon.name)}
        onMouseEnter={() => setActive(icon.name)}
        onFocus={() => setActive(icon.name)}
      >
        <Icon className="size-5" />
      </button>
    )
  }

  const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-0.5'
  const ActiveIcon = active ? catalog?.component(active) : undefined
  const categoryButton = (key: string, label: string) => (
    <Button
      key={key}
      type="button"
      size="sm"
      variant={scope === key ? 'secondary' : 'ghost'}
      className="h-7 shrink-0 px-2 text-xs"
      aria-pressed={scope === key}
      onClick={() => {
        setQuery('')
        setCategory(key)
      }}
    >
      {label}
    </Button>
  )

  return (
    <Popover open={open} onOpenChange={next => !next && onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        {...{ [EDITOR_FLOATING_ATTR]: '' }}
        align="start"
        sideOffset={8}
        className="grid w-[372px] max-w-[calc(100vw-1rem)] gap-2 rounded-xl p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          editor.commands.focus()
        }}
        // 从下拉菜单打开时，菜单关闭后会把焦点还给编辑器：不当作点到外面，焦点留在搜索框（点击编辑器仍会关闭）
        onFocusOutside={(event) => {
          if (event.target instanceof Node && editor.view.dom.contains(event.target)) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            placeholder={t('search')}
            aria-label={t(currentName ? 'replace' : 'insert')}
            className="h-9 pl-8"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (isComposingKey(event))
                return
              if (event.key === 'Enter') {
                event.preventDefault()
                // 按输入框的当前值取第一个结果（网格跟随的是延后的关键字，快速输入后立刻回车时可能还没更新）
                const first = query.trim() && catalog ? searchIcons(catalog, query, categoryLabels)[0] : recentIcons[0] ?? results[0]
                if (first)
                  pick(first.name)
              }
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                focusIcon(0)
              }
            }}
          />
        </div>

        {catalog && (
          <div
            className="hide-scrollbar -mx-2 flex gap-1 overflow-x-auto px-2"
            role="group"
            aria-label={t('category')}
            // 鼠标滚轮纵向滚动时横向滚动分类
            onWheel={(event) => {
              if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
                event.currentTarget.scrollLeft += event.deltaY
            }}
          >
            {categoryButton(ALL, t('all'))}
            {catalog.categories.map(key => categoryButton(key, t(`categories.${key}`)))}
          </div>
        )}

        <div ref={gridRef} className="h-64 overflow-y-auto overscroll-contain" onKeyDown={onGridKeyDown}>
          {state.status === 'loading' && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t('loading')}
            </div>
          )}
          {state.status === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              {t('load_failed')}
              <Button type="button" size="sm" variant="outline" onClick={retry}>{t('retry')}</Button>
            </div>
          )}
          {catalog && results.length === 0 && (
            <Empty className="h-full p-4">
              <EmptyHeader>
                <EmptyTitle className="text-sm">{t('empty')}</EmptyTitle>
                <EmptyDescription className="text-xs">{t('empty_hint')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {catalog && results.length > 0 && (
            <div className="grid gap-2">
              {recentIcons.length > 0 && (
                <section className="grid gap-1">
                  <h3 className="px-1 text-xs font-medium text-muted-foreground">{t('recent')}</h3>
                  <div className={gridClass}>{recentIcons.map(icon => renderIcon(icon, `recent:${icon.name}`))}</div>
                </section>
              )}
              <section className="grid gap-1">
                {recentIcons.length > 0 && <h3 className="px-1 text-xs font-medium text-muted-foreground">{t('all_icons')}</h3>}
                <div data-icon-grid className={gridClass}>{shown.map(icon => renderIcon(icon, icon.name))}</div>
              </section>
              {shown.length < results.length && <div ref={sentinelRef} className="h-px" />}
            </div>
          )}
        </div>

        <div className="flex h-7 items-center gap-2 border-t px-1 pt-2 text-xs text-muted-foreground">
          {ActiveIcon && <ActiveIcon className="size-4 shrink-0 text-foreground" />}
          <span className="truncate font-mono text-foreground/80">{active ?? ''}</span>
          <span className="flex-1" />
          {catalog && <span className="shrink-0">{t('count', { count: results.length })}</span>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
