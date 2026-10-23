'use client'

import type { Editor } from '@tiptap/react'
import type { InlineMarkId } from './editor-commands'
import type { EditorMenuEntry } from './editor-menus'
import type { AIWriterOpenOptions } from './use-ai-writer'
import type { EditorToolbarState } from './use-editor-toolbar-state'
import { BaselineIcon, EllipsisIcon, LinkIcon, MessageSquareTextIcon, Redo2Icon, RemoveFormattingIcon, Undo2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { ColorPopover } from '@/components/tiptap-custom/color-selector-popover'
import { toggleMark } from '@/components/tiptap-ui/mark-button/use-mark'
import { executeUndoRedoAction } from '@/components/tiptap-ui/undo-redo-button/use-undo-redo'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAIPrompts } from './ai-prompts-context'
import { INLINE_MARKS, PRIMARY_MARKS } from './editor-commands'
import {
  AIMenu,
  AlignMenu,
  BlockTypeMenu,
  EditorMenuContent,
  EditorMenuEntries,
  getAIEntries,
  getAlignEntries,
  getInsertMenuEntries,
  InsertMenu,
} from './editor-menus'
import { EditorToolbarButton, EditorToolbarSeparator, EditorTooltip } from './editor-toolbar-button'
import { useEditorToolbarState } from './use-editor-toolbar-state'

type Translate = ReturnType<typeof useTranslations>

export interface EditorToolbarActions {
  openLink: () => void
  openAnnotation: () => void
  openAI: (options?: AIWriterOpenOptions) => void
  openComponentLibrary: () => void
}

/** 标记按钮组（粗体、斜体……），工具栏与气泡菜单共用 */
export function MarkButtons({ editor, state, marks = PRIMARY_MARKS, tooltipSide }: {
  editor: Editor
  state: EditorToolbarState
  marks?: InlineMarkId[]
  tooltipSide?: 'top' | 'bottom'
}) {
  const t = useTranslations('Console.editor')
  return marks.map((id) => {
    const Icon = INLINE_MARKS[id].icon
    return (
      <EditorToolbarButton
        key={id}
        label={t(`mark.${id}`)}
        shortcut={INLINE_MARKS[id].shortcut}
        tooltipSide={tooltipSide}
        active={state.marks[id].active}
        disabled={!state.marks[id].can}
        onClick={() => toggleMark(editor, id)}
      >
        <Icon />
      </EditorToolbarButton>
    )
  })
}

/** 文字颜色按钮：图标下方的两段色条分别显示当前文字颜色与高亮 */
export function ColorButton({ editor, state, tooltipSide }: { editor: Editor, state: EditorToolbarState, tooltipSide?: 'top' | 'bottom' }) {
  const t = useTranslations('Console.editor')
  return (
    <ColorPopover editor={editor} textColor={state.textColor} highlightColor={state.highlightColor}>
      <EditorToolbarButton
        label={t('color')}
        shortcut="mod+shift+h"
        tooltipSide={tooltipSide}
        disabled={!state.canColor}
        className="flex-col gap-px pt-0.5"
      >
        <BaselineIcon className="size-[17px]" />
        <span className="flex gap-0.5" aria-hidden="true">
          <i className="block h-[3px] w-2 rounded-full" style={{ background: state.textColor ?? 'currentColor' }} />
          <i className="block h-[3px] w-2 rounded-full ring-1 ring-border ring-inset" style={{ background: state.highlightColor ?? 'transparent' }} />
        </span>
      </EditorToolbarButton>
    </ColorPopover>
  )
}

export function LinkAnnotationButtons({ state, actions, tooltipSide }: { state: EditorToolbarState, actions: EditorToolbarActions, tooltipSide?: 'top' | 'bottom' }) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  return (
    <>
      <EditorToolbarButton label={t('link')} shortcut="mod+k" tooltipSide={tooltipSide} active={state.isLink} disabled={!state.canLink} onClick={actions.openLink}>
        <LinkIcon />
      </EditorToolbarButton>
      <EditorToolbarButton label={postEditT('annotation')} shortcut="mod+alt+m" tooltipSide={tooltipSide} active={state.isAnnotation} disabled={!state.canAnnotate} onClick={actions.openAnnotation}>
        <MessageSquareTextIcon />
      </EditorToolbarButton>
    </>
  )
}

interface ToolbarGroup {
  id: string
  // 固定分组永不收纳
  fixed?: boolean
  label?: string
  content: React.ReactNode
  overflow?: () => EditorMenuEntry[]
}

// 触屏窄屏（或极窄窗口）：工具栏改为横向滚动 + 边缘渐隐；其余宽度使用 priority+ 收纳
const SCROLL_MODE_QUERY = '(max-width: 767px) and (hover: none), (max-width: 479px)'

function useMediaQuery(query: string) {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

/**
 * 固定工具栏（单行）：撤销重做 | 块类型 | 标记 | 颜色 | 链接与注释 | 对齐 | 插入 | ⋯
 * 空间不足时从右往左把分组收进 ⋯ 菜单（priority+）；触屏窄屏改为横向滚动
 */
export function EditorToolbar({ editor, actions }: { editor: Editor, actions: EditorToolbarActions }) {
  const t = useTranslations('Console.editor')
  const ct = useTranslations('ContentComponents')
  const state = useEditorToolbarState(editor)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const groupRefs = React.useRef(new Map<string, HTMLDivElement>())
  const [hiddenGroups, setHiddenGroups] = React.useState<string[]>([])
  const [fade, setFade] = React.useState({ left: false, right: false })
  const scrollMode = useMediaQuery(SCROLL_MODE_QUERY)
  // 从溢出菜单打开颜色面板时，锚定到 ⋯ 按钮
  const [colorFromOverflow, setColorFromOverflow] = React.useState(false)
  const moreRef = React.useRef<HTMLButtonElement>(null)
  // 从溢出菜单打开 AI 面板时，关闭菜单后不把焦点抢回编辑器
  const aiOpenedRef = React.useRef(false)
  const aiPrompts = useAIPrompts()
  const openAIFromMenu = (options: AIWriterOpenOptions) => {
    aiOpenedRef.current = true
    actions.openAI(options)
  }

  const markEntries = (): EditorMenuEntry[] => PRIMARY_MARKS.map(id => markEntry(editor, t, state, id))

  const groups: ToolbarGroup[] = [
    {
      id: 'history',
      fixed: true,
      content: (
        <>
          <EditorToolbarButton label={t('undo')} shortcut="mod+z" disabled={!state.canUndo} onClick={() => executeUndoRedoAction(editor, 'undo')}>
            <Undo2Icon />
          </EditorToolbarButton>
          <EditorToolbarButton label={t('redo')} shortcut="mod+shift+z" disabled={!state.canRedo} onClick={() => executeUndoRedoAction(editor, 'redo')}>
            <Redo2Icon />
          </EditorToolbarButton>
        </>
      ),
    },
    { id: 'block', fixed: true, content: <BlockTypeMenu editor={editor} state={state} /> },
    { id: 'marks', label: t('group_marks'), content: <MarkButtons editor={editor} state={state} />, overflow: markEntries },
    {
      id: 'color',
      label: t('group_color'),
      content: <ColorButton editor={editor} state={state} />,
      overflow: () => [{ key: 'color', icon: BaselineIcon, label: t('color_more'), disabled: !state.canColor, onSelect: () => setColorFromOverflow(true) }],
    },
    {
      id: 'linkAnno',
      label: t('group_link_annotation'),
      content: <LinkAnnotationButtons state={state} actions={actions} />,
      overflow: () => [
        { key: 'link', icon: LinkIcon, label: t('link'), shortcut: 'mod+k', active: state.isLink, disabled: !state.canLink, onSelect: actions.openLink },
        { key: 'annotation', icon: MessageSquareTextIcon, label: t('annotation'), shortcut: 'mod+alt+m', active: state.isAnnotation, disabled: !state.canAnnotate, onSelect: actions.openAnnotation },
      ],
    },
    { id: 'align', label: t('align'), content: <AlignMenu editor={editor} state={state} />, overflow: () => getAlignEntries(editor, t, state) },
    { id: 'insert', label: t('insert'), content: <InsertMenu editor={editor} state={state} onOpenLibrary={actions.openComponentLibrary} />, overflow: () => getInsertMenuEntries(editor, t, ct, state, actions.openComponentLibrary) },
    {
      id: 'ai',
      label: t('ai.open'),
      content: <AIMenu editor={editor} state={state} openAI={actions.openAI} />,
      overflow: () => getAIEntries(t, state.textSelection ? 'rewrite' : 'write', openAIFromMenu, aiPrompts.prompts, {
        disabled: !state.editable,
        onManage: () => aiPrompts.openManager(state.textSelection ? 'rewrite' : 'write'),
      }),
    },
  ]

  const updateFade = React.useCallback(() => {
    const track = trackRef.current
    if (!track)
      return
    const { scrollLeft, scrollWidth, clientWidth } = track
    setFade({ left: scrollMode && scrollLeft > 2, right: scrollMode && scrollLeft + clientWidth < scrollWidth - 2 })
  }, [scrollMode])

  // priority+：先全部显示，再从最后一个可收纳分组开始隐藏，直到不再溢出
  const fit = React.useCallback(() => {
    const track = trackRef.current
    if (!track)
      return
    const entries = [...groupRefs.current.entries()]
    entries.forEach(([, el]) => {
      el.hidden = false
    })
    const hidden: string[] = []
    if (!scrollMode) {
      for (let i = entries.length - 1; i >= 0 && track.scrollWidth > track.clientWidth + 1; i--) {
        const [id, el] = entries[i]
        if (el.dataset.fixed === 'true')
          break
        el.hidden = true
        hidden.unshift(id)
      }
    }
    setHiddenGroups(prev => (prev.join() === hidden.join() ? prev : hidden))
    updateFade()
  }, [scrollMode, updateFade])

  React.useLayoutEffect(() => {
    fit()
    const root = rootRef.current
    if (!root)
      return
    const observer = new ResizeObserver(() => fit())
    observer.observe(root)
    return () => observer.disconnect()
  }, [fit])

  const overflowEntries: EditorMenuEntry[] = []
  for (const group of groups) {
    if (!hiddenGroups.includes(group.id) || !group.overflow)
      continue
    overflowEntries.push({ type: 'label', key: `label-${group.id}`, label: group.label ?? group.id }, ...group.overflow())
  }
  overflowEntries.push(
    { type: 'label', key: 'label-more', label: t('group_more') },
    markEntry(editor, t, state, 'superscript'),
    markEntry(editor, t, state, 'subscript'),
    { type: 'separator', key: 'sep-clear' },
    {
      key: 'clear',
      icon: RemoveFormattingIcon,
      label: t('clear_formatting'),
      shortcut: 'mod+\\',
      disabled: !state.editable,
      onSelect: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  )

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={t('toolbar_aria')}
      className="mx-auto flex h-11 w-full max-w-[54rem] items-center gap-0.5 rounded-xl border bg-card px-1.5 transition-colors"
    >
      <div
        ref={trackRef}
        onScroll={updateFade}
        className={cn(
          'flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap',
          scrollMode && 'hide-scrollbar overflow-x-auto [-webkit-overflow-scrolling:touch]',
        )}
        style={fadeMask(fade)}
      >
        {groups.map((group, index) => (
          <div
            key={group.id}
            ref={(el) => {
              if (el)
                groupRefs.current.set(group.id, el)
              else
                groupRefs.current.delete(group.id)
            }}
            data-fixed={group.fixed ? 'true' : 'false'}
            className="flex shrink-0 items-center gap-0.5"
          >
            {index > 0 && <EditorToolbarSeparator />}
            {group.content}
          </div>
        ))}
      </div>
      <EditorToolbarSeparator />
      <DropdownMenu modal={false}>
        <EditorTooltip label={t('more_format')}>
          <DropdownMenuTrigger asChild>
            <EditorToolbarButton ref={moreRef} label={t('more_format')} noTooltip>
              <EllipsisIcon />
            </EditorToolbarButton>
          </DropdownMenuTrigger>
        </EditorTooltip>
        <EditorMenuContent
          editor={editor}
          align="end"
          shouldRestoreFocus={() => {
            const restore = !aiOpenedRef.current
            aiOpenedRef.current = false
            return restore
          }}
        >
          <EditorMenuEntries entries={overflowEntries} />
        </EditorMenuContent>
      </DropdownMenu>
      {colorFromOverflow && (
        <ColorPopover
          editor={editor}
          textColor={state.textColor}
          highlightColor={state.highlightColor}
          align="end"
          anchorRef={moreRef}
          defaultOpen
          onClosed={() => setColorFromOverflow(false)}
        />
      )}
    </div>
  )
}

export function markEntry(editor: Editor, t: Translate, state: EditorToolbarState, id: InlineMarkId): EditorMenuEntry {
  return {
    key: `mark-${id}`,
    icon: INLINE_MARKS[id].icon,
    label: t(`mark.${id}`),
    shortcut: INLINE_MARKS[id].shortcut,
    active: state.marks[id].active,
    disabled: !state.marks[id].can,
    onSelect: () => toggleMark(editor, id),
  }
}

// 横向滚动时的边缘渐隐
function fadeMask({ left, right }: { left: boolean, right: boolean }): React.CSSProperties | undefined {
  if (!left && !right)
    return undefined
  const stops = [left ? 'transparent, #000 1.75rem' : '#000', right ? '#000 calc(100% - 1.75rem), transparent' : '#000'].join(', ')
  const mask = `linear-gradient(to right, ${stops})`
  return { maskImage: mask, WebkitMaskImage: mask }
}
