'use client'

import type { PublishSummaryItem } from './editor-app-bar'
import type { ContentEditorController } from '@/hooks/use-content-editor'
import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { EditSessionBanner } from '@/components/console/common/edit-session-banner'
import { AnnotationPopover } from '@/components/tiptap-ui/annotation-popover'
import { LinkPopover } from '@/components/tiptap-ui/link-popover'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { useFullscreen } from '@/hooks/use-editor-helpers'
import { cn } from '@/lib/utils'
import { EditorAppBar } from './editor-app-bar'
import { EditorBubbleMenu } from './editor-bubble-menu'
import { EditorCanvas } from './editor-canvas'
import { EditorStatusBar } from './editor-status-bar'
import { EditorToolbar } from './editor-toolbar'
import { useEditorStats } from './use-editor-stats'
import 'highlight.js/styles/github-dark.css'
import './editor-content.scss'

export interface EditorShellPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ContentEditorShellProps {
  controller: ContentEditorController
  backHref: string
  backLabel: string
  crumbRoot: string
  untitled: string
  titleLabel: string
  descriptionLabel: string
  settingsLabel: string
  publishTitle: string
  publishSummary: PublishSummaryItem[]
  metaLine?: React.ReactNode
  // 设置面板与预览由文章 / 页面各自实现
  renderSettings: (props: EditorShellPanelProps) => React.ReactNode
  renderPreview: (props: EditorShellPanelProps) => React.ReactNode
}

/**
 * 文章 / 页面编辑器的外壳：应用栏、固定工具栏、写作画布、气泡菜单、状态栏、设置抽屉与预览
 * 布局为填满后台内容区的 flex 列，应用栏与工具栏吸顶、状态栏吸底；专注模式下铺满窗口并隐藏界面
 */
export function ContentEditorShell(props: ContentEditorShellProps) {
  const { controller } = props
  const postEditT = useTranslations('Console.post_edit')

  if (controller.loadState === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <span>{postEditT('load_failed')}</span>
        <Button size="sm" variant="outline" onClick={controller.reload}>{postEditT('retry')}</Button>
      </div>
    )
  }

  if (controller.loadState === 'loading' || !controller.editor)
    return <EditorSkeleton label={postEditT('loading')} />

  return <LoadedShell {...props} />
}

function EditorSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3" aria-busy="true" aria-label={label}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mx-auto h-11 w-full max-w-[54rem] rounded-xl" />
      <Skeleton className="mx-auto h-[60vh] w-full max-w-[54rem] rounded-2xl" />
    </div>
  )
}

function LoadedShell({
  controller,
  backHref,
  backLabel,
  crumbRoot,
  untitled,
  titleLabel,
  descriptionLabel,
  settingsLabel,
  publishTitle,
  publishSummary,
  metaLine,
  renderSettings,
  renderPreview,
}: ContentEditorShellProps) {
  const t = useTranslations('Console.editor')
  const postEditT = useTranslations('Console.post_edit')
  const editor = controller.editor!
  const { meta, updateMeta, readOnly, editSession } = controller
  const { words } = useEditorStats(editor)

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [focusMode, setFocusMode] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [annotationOpen, setAnnotationOpen] = React.useState(false)
  const onFullscreenError = React.useCallback(() => toast.error(postEditT('fullscreen_failed')), [postEditT])
  const { isFullScreen, toggleFullScreen } = useFullscreen(onFullscreenError)

  // 链接 / 注释弹层：工具栏、气泡菜单与快捷键共用，定位到当前选区
  const actions = React.useMemo(() => ({
    openLink: () => {
      if (!editor.isEditable || editor.isActive('codeBlock'))
        return
      setAnnotationOpen(false)
      setLinkOpen(true)
    },
    openAnnotation: () => {
      if (!editor.isEditable || editor.isActive('codeBlock'))
        return
      if (!editor.isActive('annotation') && editor.state.selection.empty)
        return
      setLinkOpen(false)
      setAnnotationOpen(true)
    },
  }), [editor])
  React.useEffect(() => {
    controller.uiActionsRef.current = actions
  }, [controller.uiActionsRef, actions])

  const toggleFocusMode = React.useCallback((next?: boolean) => {
    setFocusMode((prev) => {
      const value = next ?? !prev
      if (value)
        window.setTimeout(() => editor.commands.focus(), 0)
      return value
    })
  }, [editor])

  // 全局快捷键：⌘⇧P 预览、⌘⇧. 专注模式、Esc 退出专注
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPreviewOpen(open => !open)
        return
      }
      if (mod && event.shiftKey && (event.key === '.' || event.key === '>')) {
        event.preventDefault()
        toggleFocusMode()
        return
      }
      if (event.key === 'Escape' && !event.defaultPrevented && focusMode) {
        // 弹层、菜单等打开时由它们自己处理 Esc
        if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]'))
          return
        toggleFocusMode(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusMode, toggleFocusMode])

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(editor.getHTML())
      toast.success(t('copy_html_success'))
    }
    catch {
      toast.error(t('copy_html_failed'))
    }
  }

  const chromeClass = cn('transition-opacity duration-200', focusMode && 'pointer-events-none opacity-0')

  return (
    <div
      className={cn(
        'neo-editor-shell relative flex flex-1 flex-col',
        // 抵消后台内容区内边距，让编辑器铺满内容区
        '-m-(--console-content-padding)',
        focusMode && 'neo-focus-mode fixed inset-0 z-50 m-0 overflow-y-auto bg-background',
      )}
    >
      <EditorAppBar
        className={chromeClass}
        backHref={backHref}
        backLabel={backLabel}
        crumbRoot={crumbRoot}
        title={meta.title.trim() || untitled}
        isPrivate={meta.isPrivate}
        hasUnpublishedChanges={controller.hasUnpublishedChanges}
        words={words}
        saveState={controller.saveState}
        saveError={controller.saveError}
        lastSavedAt={controller.lastSavedAt}
        readOnly={readOnly}
        canSave={controller.canSave}
        publishing={controller.publishing}
        publishTitle={publishTitle}
        publishSummary={publishSummary}
        isFullScreen={isFullScreen}
        focusMode={focusMode}
        settingsLabel={settingsLabel}
        onSave={() => void controller.save({ manual: true })}
        onPublish={controller.publish}
        onPreview={() => setPreviewOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleFocusMode={() => toggleFocusMode()}
        onToggleFullScreen={toggleFullScreen}
        onCopyHtml={copyHtml}
      />

      {focusMode && (
        <Button
          variant="secondary"
          size="sm"
          className="fixed top-3 right-4 z-[51] opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          onClick={() => toggleFocusMode(false)}
        >
          <XIcon />
          {t('focus_exit')}
          <Kbd>Esc</Kbd>
        </Button>
      )}

      {editSession.status === 'taken_over' && (
        <div className="px-2 pb-2 md:px-4">
          <EditSessionBanner className="mx-auto max-w-[54rem]" holder={editSession.holder} onTakeOver={controller.takeOver} />
        </div>
      )}

      {!readOnly && (
        <div className={cn('sticky top-13 z-20 bg-linear-to-b from-background from-70% to-transparent px-2 pb-1.5 md:top-14 md:px-4 md:pb-2', chromeClass)}>
          <EditorToolbar editor={editor} actions={actions} />
        </div>
      )}

      <main className={cn('flex-1 px-2 pt-1 pb-12 md:px-4 md:pb-16', focusMode && 'pt-12')}>
        <EditorCanvas
          editor={editor}
          className={cn(focusMode && 'bg-transparent')}
          title={meta.title}
          description={meta.description}
          onTitleChange={title => updateMeta({ title })}
          onDescriptionChange={description => updateMeta({ description })}
          titlePlaceholder={untitled}
          descriptionPlaceholder={t('description_placeholder')}
          titleLabel={titleLabel}
          descriptionLabel={descriptionLabel}
          readOnly={readOnly}
          metaLine={metaLine}
        />
      </main>

      <EditorStatusBar editor={editor} sessionStatus={editSession.status} className={chromeClass} />

      {!readOnly && <EditorBubbleMenu editor={editor} actions={actions} />}
      <LinkPopover editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      <AnnotationPopover editor={editor} open={annotationOpen} onOpenChange={setAnnotationOpen} />

      {renderSettings({ open: settingsOpen, onOpenChange: setSettingsOpen })}
      {renderPreview({ open: previewOpen, onOpenChange: setPreviewOpen })}
    </div>
  )
}
