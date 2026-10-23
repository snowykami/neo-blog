'use client'

import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { PuzzleIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { ComponentPropsDialog } from '@/components/content-components/component-props-dialog'
import { ContentComponentView } from '@/components/content-components/content-component-view'
import { resolveComponent } from '@/components/content-components/props'
import { EditorToolbarButton, EditorToolbarSeparator } from '@/components/tiptap-editor/editor-toolbar-button'
import { cn } from '@/lib/utils'
import { COMPONENT_BLOCK_TOOLBAR_ATTR } from './component-block-constants'
import { consumePendingComponentEdit } from './pending-edit'

/** 预览不可用时的占位：未知组件 / props 无效 / 渲染出错 */
function BlockNotice({ title, hint }: { title: string, hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 px-4 py-3.5 text-sm text-muted-foreground">
      <PuzzleIcon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium text-foreground/80">{title}</p>
        {hint && <p className="text-xs">{hint}</p>}
      </div>
    </div>
  )
}

/**
 * 组件块节点视图：实时渲染与前台相同的组件作为预览；选中时显示浮动工具栏（编辑属性 / 删除），双击打开属性编辑
 */
export function ComponentBlockView({ editor, node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const t = useTranslations('ContentComponents')
  const { name, props, version } = node.attrs as { name: string | null, props: Record<string, unknown>, version: number | null }
  const resolved = useMemo(() => resolveComponent(name, props, version), [name, props, version])
  const def = resolved.def
  const editable = editor.isEditable
  const [editing, setEditing] = useState(false)

  // 刚插入的组件自动打开属性编辑
  useEffect(() => {
    if (def && editable && consumePendingComponentEdit(editor))
      setEditing(true)
  }, [def, editable, editor])

  const label = def ? t(`${def.name}.name`) : (name || t('unknown_name'))
  const Icon = def?.icon ?? PuzzleIcon

  return (
    <NodeViewWrapper
      data-drag-handle=""
      contentEditable={false}
      className={cn(
        'neo-component-block group/component relative my-6 rounded-xl outline-offset-4 transition-[outline-color]',
        selected ? 'outline-2 outline-primary' : 'outline-2 outline-transparent hover:outline-foreground/10',
      )}
      // 编辑器中点击预览里的链接只选中节点，不跳转
      onClickCapture={(event: React.MouseEvent) => {
        if ((event.target as Element).closest('a'))
          event.preventDefault()
      }}
      onDoubleClick={() => def && editable && setEditing(true)}
    >
      {resolved.ok
        ? (
            <ContentComponentView
              def={resolved.def}
              props={resolved.props}
              className="my-0"
              errorFallback={<BlockNotice title={t('render_failed')} hint={t('edit_hint')} />}
            />
          )
        : <BlockNotice title={resolved.reason === 'unknown' ? t('unknown', { name: label }) : label} hint={resolved.reason === 'unknown' ? t('unknown_hint') : t('invalid')} />}

      {editable && (
        <div
          {...{ [COMPONENT_BLOCK_TOOLBAR_ATTR]: '' }}
          role="toolbar"
          aria-label={t('toolbar', { name: label })}
          className={cn(
            // 位于组件上方，不遮挡组件自身的按钮
            'absolute right-0 bottom-[calc(100%+6px)] z-10 flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg transition-opacity',
            selected ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover/component:pointer-events-auto group-hover/component:opacity-100',
          )}
        >
          <span className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-3.5" />
            {label}
          </span>
          <EditorToolbarSeparator className="mx-0.5" />
          {def && (
            <EditorToolbarButton label={t('edit')} className="h-[30px] min-w-[30px]" onClick={() => setEditing(true)}>
              <Settings2Icon className="size-[17px]" />
            </EditorToolbarButton>
          )}
          <EditorToolbarButton
            label={t('delete')}
            className="h-[30px] min-w-[30px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={deleteNode}
          >
            <Trash2Icon className="size-[17px]" />
          </EditorToolbarButton>
        </div>
      )}

      {def && (
        <ComponentPropsDialog
          def={def}
          open={editing}
          onOpenChange={(open) => {
            setEditing(open)
            if (!open)
              editor.commands.focus()
          }}
          value={props}
          onSubmit={next => updateAttributes({ props: next, version: def.version })}
        />
      )}
    </NodeViewWrapper>
  )
}
