'use client'

import type { Editor } from '@tiptap/react'
import type { ComponentProps } from 'react'
import type { EditorToolbarActions } from './editor-toolbar'
import { NodeSelection } from '@tiptap/pm/state'
import { isTextSelection } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { EDITOR_FLOATING_ATTR } from '@/components/tiptap-ui/link-popover/floating'
import { AIMenu, BlockTypeMenu, FontMenu } from './editor-menus'
import { ColorButton, LinkAnnotationButtons, MarkButtons } from './editor-toolbar'
import { EditorToolbarSeparator } from './editor-toolbar-button'
import { useEditorToolbarState } from './use-editor-toolbar-state'

const BUBBLE_MENU_KEY = 'editorBubbleMenu'

type BubbleShouldShow = NonNullable<ComponentProps<typeof BubbleMenu>['shouldShow']>
type BubbleOptions = NonNullable<ComponentProps<typeof BubbleMenu>['options']>

/** 焦点是否位于编辑器的浮层（气泡菜单、弹层、下拉菜单）中 */
function isFocusInFloating() {
  const active = document.activeElement
  return !!active?.closest?.(`[${EDITOR_FLOATING_ATTR}]`)
}

function EditorBubbleMenuContent({ editor, actions }: { editor: Editor, actions: EditorToolbarActions }) {
  const state = useEditorToolbarState(editor)

  // 菜单内容首次挂载后再触发一次定位，让 Floating UI 按真实宽高对齐选区
  React.useLayoutEffect(() => {
    if (!editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_KEY, 'updatePosition'))
  }, [editor])

  return (
    <>
      <AIMenu editor={editor} state={state} openAI={actions.openAI} />
      <EditorToolbarSeparator className="mx-1" />
      <BlockTypeMenu editor={editor} state={state} compact />
      <EditorToolbarSeparator className="mx-1" />
      <MarkButtons editor={editor} state={state} tooltipSide="top" />
      <EditorToolbarSeparator className="mx-1" />
      <LinkAnnotationButtons state={state} actions={actions} tooltipSide="top" />
      <EditorToolbarSeparator className="mx-1" />
      <ColorButton editor={editor} state={state} tooltipSide="top" />
      <FontMenu editor={editor} state={state} tooltipSide="top" />
    </>
  )
}

/**
 * 选中文字时出现的气泡菜单：AI 润色 | 块类型 | 标记 | 链接、注释 | 颜色、字体
 * 挂载到 body，打开其中的下拉 / 弹层时焦点移入浮层，菜单保持显示；隐藏时不渲染内部菜单项
 */
export function EditorBubbleMenu({ editor, actions }: { editor: Editor, actions: EditorToolbarActions }) {
  const t = useTranslations('Console.editor')
  const [visible, setVisible] = React.useState(false)
  const coarsePointer = React.useSyncExternalStore(
    () => () => {},
    () => window.matchMedia('(hover: none)').matches,
    () => false,
  )

  // 焦点移到编辑器与浮层之外（如标题输入框）时隐藏气泡菜单
  React.useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (!target || editor.isDestroyed)
        return
      if (editor.view.dom.contains(target) || target.closest(`[${EDITOR_FLOATING_ATTR}]`))
        return
      editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_MENU_KEY, 'hide'))
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [editor])

  const appendTo = React.useCallback(() => document.body, [])

  const shouldShow = React.useCallback<BubbleShouldShow>(({ editor: ed, view, state: editorState, from, to }) => {
    const { selection } = editorState
    if (!ed.isEditable || selection.empty || selection instanceof NodeSelection || !isTextSelection(selection))
      return false
    if (ed.isActive('codeBlock'))
      return false
    if (!editorState.doc.textBetween(from, to, ' ').trim().length)
      return false
    return view.hasFocus() || isFocusInFloating()
  }, [])

  const options = React.useMemo<BubbleOptions>(() => ({
    strategy: 'fixed',
    // 触屏设备上方有系统选区菜单，改为显示在下方
    placement: coarsePointer ? 'bottom' : 'top',
    offset: 8,
    flip: { padding: 8 },
    shift: { padding: 8 },
    onShow: () => setVisible(true),
    onHide: () => setVisible(false),
  }), [coarsePointer])

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={BUBBLE_MENU_KEY}
      updateDelay={120}
      appendTo={appendTo}
      shouldShow={shouldShow}
      options={options}
      {...{ [EDITOR_FLOATING_ATTR]: '' }}
      role="toolbar"
      aria-label={t('bubble_aria')}
      className="z-40 flex max-w-[calc(100vw-1rem)] items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg hide-scrollbar"
    >
      {visible && <EditorBubbleMenuContent editor={editor} actions={actions} />}
    </BubbleMenu>
  )
}
