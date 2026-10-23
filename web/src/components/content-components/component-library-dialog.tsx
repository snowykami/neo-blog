'use client'

import type { LibraryNode } from './library-tree'
import type { RegisteredContentComponent } from './types'
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ContentComponentView } from './content-component-view'
import { buildLibraryTree, filterLibraryTree, flattenLibraryTree } from './library-tree'
import { resolveComponent } from './props'
import { CONTENT_COMPONENTS } from './registry'

type Translate = ReturnType<typeof useTranslations<'ContentComponents'>>

const FULL_TREE = buildLibraryTree(CONTENT_COMPONENTS)

interface TreeProps {
  nodes: LibraryNode[]
  depth: number
  // 搜索时展开全部目录
  expandAll: boolean
  collapsed: Set<string>
  onToggle: (path: string) => void
  selected: string | null
  onSelect: (def: RegisteredContentComponent) => void
  onInsert: (def: RegisteredContentComponent) => void
  t: Translate
}

/** 目录树：文件夹可折叠，组件项单击选中、双击插入 */
function LibraryTree({ nodes, depth, expandAll, collapsed, onToggle, selected, onSelect, onInsert, t }: TreeProps) {
  return nodes.map((node) => {
    const indent = { paddingLeft: `${depth * 14 + 8}px` }
    if (node.type === 'folder') {
      const open = expandAll || !collapsed.has(node.path)
      const Icon = open ? FolderOpenIcon : FolderIcon
      return (
        <div key={node.path} role="treeitem" aria-expanded={open} aria-selected={false}>
          <button
            type="button"
            style={indent}
            className="flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm hover:bg-accent"
            onClick={() => onToggle(node.path)}
          >
            <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
            <Icon className="size-4 shrink-0 text-primary/80" />
            <span className="truncate font-mono text-[13px]">{node.name}</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{flattenLibraryTree(node.children).length}</span>
          </button>
          {open && (
            <div role="group">
              <LibraryTree {...{ expandAll, collapsed, onToggle, selected, onSelect, onInsert, t }} nodes={node.children} depth={depth + 1} />
            </div>
          )}
        </div>
      )
    }
    const Icon = node.def.icon
    const active = selected === node.def.name
    return (
      <button
        key={node.path}
        type="button"
        role="treeitem"
        aria-selected={active}
        style={{ paddingLeft: `${depth * 14 + 28}px` }}
        className={cn('flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm hover:bg-accent', active && 'bg-primary/10 text-primary hover:bg-primary/10')}
        onClick={() => onSelect(node.def)}
        onDoubleClick={() => onInsert(node.def)}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{t(`${node.def.name}.name`)}</span>
        <span className="ml-auto truncate pl-2 font-mono text-[11px] text-muted-foreground">{node.name}</span>
      </button>
    )
  })
}

/** 组件详情：路径、说明与示例预览 */
function ComponentDetail({ def, t, onInsert }: { def: RegisteredContentComponent, t: Translate, onInsert: () => void }) {
  const Icon = def.icon
  // 示例 props 校验失败或未提供时不渲染预览
  const example = useMemo(() => {
    if (!def.example)
      return null
    const resolved = resolveComponent(def.name, def.example(key => t(`${def.name}.example.${key}`)))
    return resolved.ok ? resolved.props : null
  }, [def, t])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t(`${def.name}.name`)}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{`components/${def.path}`}</p>
        </div>
        <Button type="button" size="sm" onClick={onInsert}>
          <PlusIcon />
          {t('library.insert')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t(`${def.name}.description`)}</p>
      <div className="grid gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t('library.preview')}</span>
        <div className="rounded-xl border border-dashed bg-background p-4">
          {example
            ? <ContentComponentView key={def.name} def={def} props={example} className="my-0" errorFallback={<p className="text-sm text-muted-foreground">{t('render_failed')}</p>} />
            : <p className="text-sm text-muted-foreground">{t('library.no_preview')}</p>}
        </div>
      </div>
    </div>
  )
}

export interface ComponentLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (name: string) => void
}

/**
 * 组件库：左侧按源码目录展示已注册的组件（可搜索），右侧为说明与示例预览；
 * 插入后由组件块自动打开属性编辑
 */
export function ComponentLibraryDialog({ open, onOpenChange, onInsert }: ComponentLibraryDialogProps) {
  const t = useTranslations('ContentComponents')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedName, setSelectedName] = useState<string | null>(null)

  const keyword = query.trim().toLowerCase()
  const tree = useMemo(() => {
    if (!keyword)
      return FULL_TREE
    return filterLibraryTree(FULL_TREE, def => [def.name, def.path, t(`${def.name}.name`), t(`${def.name}.description`), ...def.keywords]
      .some(word => word.toLowerCase().includes(keyword)))
  }, [keyword, t])
  const visible = useMemo(() => flattenLibraryTree(tree), [tree])
  // 选中项被搜索过滤掉时，改为第一个可见组件
  const selected = visible.find(def => def.name === selectedName) ?? visible[0] ?? null

  const insert = (def: RegisteredContentComponent) => {
    onOpenChange(false)
    onInsert(def.name)
  }
  const toggle = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (!next.delete(path))
      next.add(path)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(85vh,640px)] flex-col gap-4 sm:max-w-4xl"
        // 关闭后由编辑器接管焦点（插入组件时会打开属性编辑）
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('library.title')}</DialogTitle>
          <DialogDescription>{t('library.description', { count: CONTENT_COMPONENTS.length })}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder={t('library.search')}
            aria-label={t('library.search')}
            className="pl-9"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && selected) {
                event.preventDefault()
                insert(selected)
              }
            }}
          />
        </div>
        {visible.length === 0
          ? (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyTitle>{t('library.empty')}</EmptyTitle>
                  <EmptyDescription>{t('library.empty_hint')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          : (
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,12rem)_minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:grid-rows-1">
                <div role="tree" aria-label={t('library.tree')} className="overflow-y-auto rounded-lg border p-1">
                  <LibraryTree
                    nodes={tree}
                    depth={0}
                    expandAll={!!keyword}
                    collapsed={collapsed}
                    onToggle={toggle}
                    selected={selected?.name ?? null}
                    onSelect={def => setSelectedName(def.name)}
                    onInsert={insert}
                    t={t}
                  />
                </div>
                <div className="flex min-h-0 flex-col overflow-y-auto">
                  {selected && <ComponentDetail def={selected} t={t} onInsert={() => insert(selected)} />}
                </div>
              </div>
            )}
        <DialogFooter className="text-xs text-muted-foreground sm:justify-start">
          {t('library.hint')}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
