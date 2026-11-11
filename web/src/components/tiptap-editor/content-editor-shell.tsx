'use client'

import type { PublishSummaryItem } from './editor-app-bar'
import type { InlineIconPickerTarget } from '@/components/tiptap-ui/inline-icon-picker'
import type { ContentEditorController } from '@/hooks/use-content-editor'
import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'
import { toast } from 'sonner'
import { ContentFontLinks } from '@/components/blog-post/content-font-links'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EditSessionBanner } from '@/components/console/common/edit-session-banner'
import { EditorSkeleton } from '@/components/console/route-skeleton'
import { ComponentLibraryDialog } from '@/components/content-components/component-library-dialog'
import { AnnotationPopover } from '@/components/tiptap-ui/annotation-popover'
import { InlineIconPicker } from '@/components/tiptap-ui/inline-icon-picker'
import { LinkPopover } from '@/components/tiptap-ui/link-popover'
import { MathPopover } from '@/components/tiptap-ui/math-popover'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useSiteInfo } from '@/contexts/site-info-context'
import { useFullscreen } from '@/hooks/use-editor-helpers'
import { useRouter } from '@/i18n/navigation'
import { ALL_WEBFONTS, resolveContentTheme } from '@/lib/content-theme'
import { cn } from '@/lib/utils'
import { AIPromptsProvider } from './ai-prompts-context'
import { EditorAIPanel } from './editor-ai-panel'
import { EditorAppBar } from './editor-app-bar'
import { EditorBubbleMenu } from './editor-bubble-menu'
import { EditorCanvas } from './editor-canvas'
import { EditorContextMenu } from './editor-context-menu'
import { EditorRevisionSheet } from './editor-revision-sheet'
import { EditorStatusBar } from './editor-status-bar'
import { EditorToolbar } from './editor-toolbar'
import { useAIWriter } from './use-ai-writer'
import { useEditorStats } from './use-editor-stats'
import '@/app/styles/content-themes/index.scss'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
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
  const router = useRouter()
  const { words } = useEditorStats(editor)
  const { siteInfo } = useSiteInfo()

  // 编辑区与前台正文使用同一套内容主题：文章未选时跟随站点默认，页面固定跟随站点默认
  const contentTheme = resolveContentTheme(meta.contentTheme, siteInfo.contentTheme)
  React.useEffect(() => {
    editor.view.dom.setAttribute('data-content-theme', contentTheme)
  }, [editor, contentTheme])

  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [focusMode, setFocusMode] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [annotationOpen, setAnnotationOpen] = React.useState(false)
  // 正在编辑的公式节点位置
  const [mathPos, setMathPos] = React.useState<number | null>(null)
  // 图标选择器：插入（pos 为 null）或更换某个图标
  const [iconTarget, setIconTarget] = React.useState<InlineIconPickerTarget | null>(null)
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  // 版本：确认放弃修改的弹窗与版本历史抽屉（由下拉菜单打开，使用受控模式）
  const [revisionConfirm, setRevisionConfirm] = React.useState<'session' | 'unpublished' | null>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const onFullscreenError = React.useCallback(() => toast.error(postEditT('fullscreen_failed')), [postEditT])
  const { isFullScreen, toggleFullScreen } = useFullscreen(onFullscreenError)

  // AI 写作：文章信息取编辑器中的最新值；会话期间锁定编辑器并暂停自动保存
  const metaRef = React.useRef(meta)
  metaRef.current = meta
  const getAIContext = React.useCallback(() => {
    const current = metaRef.current
    return {
      title: current.title,
      description: current.description,
      category: current.category?.name ?? '',
      labels: current.labels.map(label => label.name),
    }
  }, [])
  const aiWriter = useAIWriter({
    editor,
    target: controller.kind,
    docId: controller.doc?.id,
    getContext: getAIContext,
    onBusyChange: controller.setAiBusy,
  })
  const openAI = aiWriter.open

  // 链接 / 注释弹层、AI 面板与组件库：工具栏、气泡菜单、右键菜单与快捷键共用，定位到当前选区
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
    openAI,
    openComponentLibrary: () => {
      if (editor.isEditable)
        setLibraryOpen(true)
    },
    editMath: (pos: number) => {
      if (!editor.isEditable)
        return
      setLinkOpen(false)
      setAnnotationOpen(false)
      // 选中公式节点，弹层定位到它下方
      editor.commands.setNodeSelection(pos)
      setMathPos(pos)
    },
    openIconPicker: () => {
      if (!editor.isEditable || !editor.can().insertInlineIcon('shapes'))
        return
      setLinkOpen(false)
      setAnnotationOpen(false)
      setIconTarget({ pos: null })
    },
    editIcon: (pos: number) => {
      if (!editor.isEditable)
        return
      setLinkOpen(false)
      setAnnotationOpen(false)
      // 选中图标，选择器定位到它下方
      editor.commands.setNodeSelection(pos)
      setIconTarget({ pos })
    },
  }), [editor, openAI])
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

  // 切走 / 关闭标签页前把待保存的修改写掉（关闭前的提示由 beforeunload 负责）：用 keepalive 请求，标签页关闭后仍会送达
  // SPA 跳走（含浏览器后退）由编辑器卸载时的保存负责
  const { flushSave } = controller
  React.useEffect(() => {
    const flush = () => {
      void flushSave({ keepalive: true })
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden')
        flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
    }
  }, [flushSave])

  // 点返回：先保存再跳转，保存失败时留在当前页（错误已由保存流程提示）；等待保存期间返回按钮显示加载中
  // 上次保存失败的元信息（如 slug 冲突）也重新提交一次：自动保存会跳过它，不重试的话会被当作没有修改直接离开
  // 有文件正在上传时先确认：离开后上传会取消（未完成的占位块不会存进草稿，见 use-content-editor 的 snapshotContent）
  const { hasActiveUploads } = controller
  const [leaving, setLeaving] = React.useState(false)
  const [confirmLeaveUploading, setConfirmLeaveUploading] = React.useState(false)
  const leave = React.useCallback(async () => {
    setLeaving(true)
    try {
      if (await flushSave({ retryFailedMeta: true }))
        router.push(backHref)
    }
    finally {
      setLeaving(false)
    }
  }, [flushSave, router, backHref])
  const handleBack = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    // 带修饰键或中键点击是「新标签页打开」，保持浏览器默认行为
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return
    event.preventDefault()
    if (leaving)
      return
    if (hasActiveUploads()) {
      setConfirmLeaveUploading(true)
      return
    }
    void leave()
  }, [leaving, hasActiveUploads, leave])

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
    // AI 指令列表与指令管理弹窗：工具栏、气泡菜单、右键菜单与 AI 面板共用
    <AIPromptsProvider>
      <div
        className={cn(
          'neo-editor-shell relative flex flex-1 flex-col',
          // 抵消后台内容区内边距，让编辑器铺满内容区
          '-m-(--console-content-padding)',
          focusMode && 'neo-focus-mode fixed inset-0 z-50 m-0 overflow-y-auto bg-background',
        )}
      >
        {/* 切换主题、设置局部字体都可能用到任一网页字体，编辑器里全部声明（只下载用到的分片） */}
        <ContentFontLinks fonts={ALL_WEBFONTS} />
        <EditorAppBar
          className={chromeClass}
          backHref={backHref}
          backLabel={backLabel}
          onBack={handleBack}
          backPending={leaving}
          crumbRoot={crumbRoot}
          title={meta.title.trim() || untitled}
          isPrivate={meta.isPrivate}
          hasUnpublishedChanges={controller.hasUnpublishedChanges}
          words={words}
          saveState={controller.saveState}
          saveError={controller.saveError}
          lastSavedAt={controller.lastSavedAt}
          readOnly={readOnly}
          aiBusy={controller.aiBusy}
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
          canRevertSession={controller.canRevertSession}
          canDiscardUnpublished={controller.canDiscardUnpublished}
          onRevertSession={() => setRevisionConfirm('session')}
          onDiscardUnpublished={() => setRevisionConfirm('unpublished')}
          onOpenHistory={() => setHistoryOpen(true)}
        />

        <ConfirmDialog
          open={confirmLeaveUploading}
          onOpenChange={setConfirmLeaveUploading}
          title={t('leave_uploading_title')}
          description={t('leave_uploading_description')}
          confirmLabel={t('leave_uploading_confirm')}
          onConfirm={() => void leave()}
        />

        <ConfirmDialog
          open={revisionConfirm !== null}
          onOpenChange={open => !open && setRevisionConfirm(null)}
          title={revisionConfirm === 'unpublished' ? t('revision.discard_unpublished_title') : t('revision.revert_session_title')}
          description={revisionConfirm === 'unpublished' ? t('revision.discard_unpublished_description') : t('revision.revert_session_description')}
          confirmLabel={revisionConfirm === 'unpublished' ? t('revision.discard_unpublished') : t('revision.revert_session')}
          errorText={t('revision.revert_failed')}
          onConfirm={async () => {
            if (revisionConfirm === 'unpublished')
              await controller.discardUnpublished()
            else
              await controller.revertSession()
            toast.success(t('revision.reverted'))
          }}
        />
        {controller.doc && (
          <EditorRevisionSheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            target={controller.kind}
            docId={controller.doc.id}
            schema={editor.schema}
            baseRevisionId={editSession.baseRevisionId}
            readOnly={readOnly}
            onRestore={async (revisionId) => {
              await controller.restoreToRevision(revisionId)
              toast.success(t('revision.restored'))
            }}
            onDelete={controller.deleteRevisions}
          />
        )}

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
          <EditorContextMenu editor={editor} actions={actions}>
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
              readOnly={readOnly || controller.aiBusy}
              metaLine={metaLine}
            />
          </EditorContextMenu>
        </main>

        <EditorStatusBar editor={editor} sessionStatus={editSession.status} className={chromeClass} />

        {!readOnly && <EditorBubbleMenu editor={editor} actions={actions} />}
        <EditorAIPanel editor={editor} writer={aiWriter} />
        <LinkPopover editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
        <AnnotationPopover editor={editor} open={annotationOpen} onOpenChange={setAnnotationOpen} />
        <MathPopover editor={editor} pos={mathPos} onClose={() => setMathPos(null)} />
        <InlineIconPicker editor={editor} target={iconTarget} onClose={() => setIconTarget(null)} />
        <ComponentLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          onInsert={name => editor.chain().focus().insertComponentBlock(name).run()}
        />

        {renderSettings({ open: settingsOpen, onOpenChange: setSettingsOpen })}
        {renderPreview({ open: previewOpen, onOpenChange: setPreviewOpen })}
      </div>
    </AIPromptsProvider>
  )
}
