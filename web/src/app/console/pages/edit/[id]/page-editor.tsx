'use client'

import type { Editor } from '@tiptap/react'
import type { PageModel } from '@/models/page'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Color from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { FullscreenIcon, MinimizeIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isEditSessionConflict } from '@/api/edit-session'
import { uploadFile } from '@/api/file'
import { getPageById, updatePage } from '@/api/page'
import { EditSessionBanner } from '@/components/console/common/edit-session-banner'
import { LastSavedAt } from '@/components/console/common/last-saved-at'
import { SimpleEditor } from '@/components/tiptap-editor/simple-editor'
import { Annotation, LinkAutoMatch } from '@/components/tiptap-extension/annotation-extension'
import { SelectionHighlight } from '@/components/tiptap-extension/selection-highlight-extension'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImagePaste } from '@/components/tiptap-node/image-node/image-paste-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { Button } from '@/components/ui/button'
import { useEditSession } from '@/hooks/use-edit-session'
import { useOperationT } from '@/hooks/use-translations'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'
import { PageMetaDialog } from '../../page-meta-dialog'

const lowlight = createLowlight(common)

export function PageEditor() {
  const { id } = useParams() as { id: string }
  const [page, setPage] = useState<PageModel | null>(null)
  // 同一页面同时只允许最新打开的编辑页保存，被顶掉后只读
  const editSession = useEditSession('page', Number(id))
  // 最近一次成功保存（或加载）的内容，自动保存只在内容变化时提交
  const savedHtmlRef = useRef<string | null>(null)

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const res = await uploadFile({ file })
      return res.data.url
    }
    catch {
      toast.error('Image upload failed')
      return ''
    }
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'autocomplete': 'off',
        'autocorrect': 'off',
        'autocapitalize': 'off',
        'aria-label': 'Page content area',
        'class': 'simple-editor',
      },
    },
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
      Color.configure({ types: ['textStyle'] }),
      HorizontalRule,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyleKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Annotation,
      LinkAutoMatch,
      // 打开注释、链接等弹窗时保留选区高亮
      SelectionHighlight,
      // 粘贴图片时按默认压缩等级上传并插入到光标处
      ImagePaste.configure({ upload: handleImageUpload }),
      Typography,
      Superscript,
      Subscript,
      CodeBlockLowlight.configure({ lowlight }),
      ImageUploadNode.configure({
        accept: 'image/*',
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: error => console.error('Upload failed:', error),
      }),
    ],
  })

  useEffect(() => {
    getPageById({ id, type: 'draft' }).then(res => setPage(res.data))
  }, [id])

  // 仅在首次加载页面时写入编辑器内容；之后修改元信息也会更新 page，
  // 若每次都 setContent 会用旧草稿覆盖用户尚未保存的编辑
  const loadedPageIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editor || !page || loadedPageIdRef.current === page.id)
      return
    const content = page.draftContent || page.content || '<p>Empty</p>'
    const timer = window.setTimeout(() => {
      editor.commands.setContent(content)
      savedHtmlRef.current = editor.getHTML()
      loadedPageIdRef.current = page.id
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editor, page])

  // 被其他编辑会话顶掉后只读
  const isTakenOver = editSession.status === 'taken_over'
  useEffect(() => {
    editor?.setEditable(!isTakenOver)
  }, [editor, isTakenOver])

  // 接管编辑：重新申请会话并加载服务端最新内容（本地未保存的内容以服务端为准）
  const handleTakeOver = useCallback(async () => {
    if (!editor || !(await editSession.takeOver()))
      return
    const latest = (await getPageById({ id, type: 'draft' })).data
    if (!latest)
      return
    editor.commands.setContent(latest.draftContent || latest.content || '<p>Empty</p>')
    savedHtmlRef.current = editor.getHTML()
    setPage(latest)
  }, [editor, editSession, id])

  const onPageUpdate = ({ page: nextPage }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => {
    setPage(prev => (prev ? { ...prev, ...nextPage } : prev))
  }

  if (!page || !editor)
    return <div>Loading...</div>

  return (
    <div
      className="w-auto editor-container
    h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6.5rem)]
    md:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6rem)]
    lg:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-5.5rem)]
    "
    >
      <PageEditorNavbar
        editor={editor}
        page={page}
        onPageUpdate={onPageUpdate}
        editSession={editSession}
        savedHtmlRef={savedHtmlRef}
      />
      {isTakenOver && <EditSessionBanner holder={editSession.holder} onTakeOver={handleTakeOver} />}
      <div className="relative mt-4 h-full">
        <SimpleEditor editor={editor} />
      </div>
    </div>
  )
}

function PageEditorNavbar({
  editor,
  onPageUpdate,
  page,
  editSession,
  savedHtmlRef,
}: {
  editor: Editor
  onPageUpdate: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  page: PageModel
  editSession: ReturnType<typeof useEditSession>
  savedHtmlRef: React.RefObject<string | null>
}) {
  const t = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [settingDialogOpen, setSettingDialogOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  const { sessionId, status: sessionStatus, markTakenOver, check: checkEditSession } = editSession
  // 被顶掉或会话申请中不保存；申请失败时（如后端未更新）退化为不带会话保存
  const canSave = sessionStatus === 'active' || sessionStatus === 'error'

  const saveDraft = useCallback((showToast: boolean) => {
    if (!canSave)
      return
    const html = editor.getHTML()
    setSavingDraft(true)
    updatePage({ page: { id: page.id, draftContent: html }, editSessionId: sessionId })
      .then(() => {
        savedHtmlRef.current = html
        if (showToast)
          toast.success(operationT('save_success'))
        setLastSavedAt(new Date())
      })
      .catch((error) => {
        // 已被其他编辑会话接管，切换为只读并提示
        if (isEditSessionConflict(error)) {
          markTakenOver()
          return
        }
        toast.error(operationT('save_failed'))
      })
      .finally(() => setSavingDraft(false))
  }, [canSave, editor, operationT, page.id, sessionId, savedHtmlRef, markTakenOver])

  // 定时保存：内容有变化才保存，没有变化时只检查编辑会话是否仍有效
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (editor.getHTML() === savedHtmlRef.current)
        checkEditSession()
      else
        saveDraft(false)
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [editor, saveDraft, savedHtmlRef, checkEditSession])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveDraft(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveDraft])

  const publishPage = () => {
    if (!canSave)
      return
    const html = editor.getHTML()
    updatePage({ page: { id: page.id, draftContent: html, content: html, type: 'html' }, editSessionId: sessionId })
      .then(() => {
        savedHtmlRef.current = html
        setLastSavedAt(new Date())
        toast.success(operationT('publish_success'))
      })
      .catch((error) => {
        if (isEditSessionConflict(error)) {
          markTakenOver()
          return
        }
        toast.error(operationT('publish_failed'))
      })
  }

  const handleToggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(error => toast.error(error.message))
      setIsFullScreen(true)
      return
    }
    document.exitFullscreen()
    setIsFullScreen(false)
  }

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg font-semibold truncate block" title={page.title}>{page.title}</span>
        {lastSavedAt && (
          <LastSavedAt time={lastSavedAt} className="text-sm text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PageMetaDialog open={settingDialogOpen} onOpenChange={setSettingDialogOpen} page={page} onPageChange={onPageUpdate} />
        <Button size="sm" onClick={handleToggleFullScreen} variant="outline">
          {isFullScreen ? <MinimizeIcon className="size-4" /> : <FullscreenIcon className="size-4" />}
        </Button>
        <Button size="sm" onClick={() => setSettingDialogOpen(true)} variant="outline">{operationT('setting')}</Button>
        <Button size="sm" onClick={() => saveDraft(true)} variant="outline" disabled={savingDraft || !canSave}>
          {savingDraft ? t('saving_draft') : t('save_draft')}
        </Button>
        <Button size="sm" onClick={publishPage} disabled={!canSave}>{operationT('publish')}</Button>
      </div>
    </div>
  )
}
