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
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { getPageById, updatePage } from '@/api/page'
import { SimpleEditor } from '@/components/tiptap-editor/simple-editor'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { Button } from '@/components/ui/button'
import { useOperationT } from '@/hooks/use-translations'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'
import { PageMetaDialog } from '../../page-meta-dialog'

const lowlight = createLowlight(common)

export function PageEditor() {
  const { id } = useParams() as { id: string }
  const [page, setPage] = useState<PageModel | null>(null)

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

  useEffect(() => {
    if (!editor || !page)
      return
    const content = page.draftContent || page.content || '<p>Empty</p>'
    const timer = window.setTimeout(() => editor.commands.setContent(content), 0)
    return () => window.clearTimeout(timer)
  }, [editor, page])

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
      <PageEditorNavbar editor={editor} page={page} onPageUpdate={onPageUpdate} />
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
}: {
  editor: Editor
  onPageUpdate: ({ page }: { page: Partial<PageModel> & Pick<PageModel, 'id'> }) => void
  page: PageModel
}) {
  const operationT = useOperationT()
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [settingDialogOpen, setSettingDialogOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  const saveDraft = useCallback((showToast: boolean) => {
    setSavingDraft(true)
    updatePage({ page: { id: page.id, draftContent: editor.getHTML() } })
      .then(() => {
        if (showToast)
          toast.success(operationT('save_success'))
        setLastSavedAt(new Date())
      })
      .catch(() => toast.error(operationT('save_failed')))
      .finally(() => setSavingDraft(false))
  }, [editor, operationT, page.id])

  useEffect(() => {
    const timer = window.setInterval(() => saveDraft(false), 10_000)
    return () => window.clearInterval(timer)
  }, [saveDraft])

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
    const html = editor.getHTML()
    updatePage({ page: { id: page.id, draftContent: html, content: html, type: 'html' } })
      .then(() => toast.success(operationT('publish_success')))
      .catch(() => toast.error(operationT('publish_failed')))
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
          <span className="text-sm text-muted-foreground">{lastSavedAt.toLocaleTimeString()}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PageMetaDialog open={settingDialogOpen} onOpenChange={setSettingDialogOpen} page={page} onPageChange={onPageUpdate} />
        <Button size="sm" onClick={handleToggleFullScreen} variant="outline">
          {isFullScreen ? <MinimizeIcon className="size-4" /> : <FullscreenIcon className="size-4" />}
        </Button>
        <Button size="sm" onClick={() => setSettingDialogOpen(true)} variant="outline">{operationT('setting')}</Button>
        <Button size="sm" onClick={() => saveDraft(true)} variant="outline" disabled={savingDraft}>
          {savingDraft ? '保存中' : '保存草稿'}
        </Button>
        <Button size="sm" onClick={publishPage}>{operationT('publish')}</Button>
      </div>
    </div>
  )
}
