'use client'
import type { Editor } from '@tiptap/react'
import type { Post } from '@/models/post'
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
// InitializedMDXEditor.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isEditSessionConflict } from '@/api/edit-session'
import { uploadFile } from '@/api/file'
import { getPostById, updatePost } from '@/api/post'
import { EditSessionBanner } from '@/components/console/common/edit-session-banner'
import { LastSavedAt } from '@/components/console/common/last-saved-at'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '@/components/console/common/post-meta-dialog-form'
import { SimpleEditor } from '@/components/tiptap-editor/simple-editor'
import { Annotation, LinkAutoMatch } from '@/components/tiptap-extension/annotation-extension'
import { SelectionHighlight } from '@/components/tiptap-extension/selection-highlight-extension'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImagePaste } from '@/components/tiptap-node/image-node/image-paste-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { Button } from '@/components/ui/button'
import { useEditSession } from '@/hooks/use-edit-session'
import { useFullscreen, useUnsavedChangesWarning } from '@/hooks/use-editor-helpers'
import { useOperationT } from '@/hooks/use-translations'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'
import { PostPreviewDialogWithButton } from './post-preview'

const lowlight = createLowlight(common)

export function PostEditor() {
  const t = useTranslations('Console.post_edit')
  const { id } = useParams() as { id: string }
  const [post, setPost] = useState<Post | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // 同一文章同时只允许最新打开的编辑页保存，被顶掉后只读
  const editSession = useEditSession('post', Number(id))
  // 最近一次成功保存（或加载）的内容，自动保存只在内容变化时提交
  const savedHtmlRef = useRef<string | null>(null)

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const res = await uploadFile({ file })
      return res.data.url
    }
    catch {
      toast.error(t('image_upload_failed'))
      return ''
    }
  }, [t])

  // Tiptap editor
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'autocomplete': 'off',
        'autocorrect': 'off',
        'autocapitalize': 'off',
        'aria-label': t('editor_aria_label'),
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
      CodeBlockLowlight.configure({
        lowlight,
      }),
      ImageUploadNode.configure({
        accept: 'image/*',
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: error => console.error('Upload failed:', error),
      }),
    ],
  })

  // 加载草稿（单篇接口，草稿模式会返回 draftContent）；失败时显示错误状态而不是一直加载
  const loadPost = useCallback(() => {
    setLoadFailed(false)
    getPostById({ id, type: 'draft' })
      .then((res) => {
        setPost(res.data)
      })
      .catch(() => setLoadFailed(true))
  }, [id])

  useEffect(() => {
    loadPost()
  }, [loadPost])

  // 有未保存修改时关闭标签页前提示
  const hasUnsavedChanges = useCallback(
    () => Boolean(editor && savedHtmlRef.current !== null && editor.getHTML() !== savedHtmlRef.current),
    [editor],
  )
  useUnsavedChangesWarning(hasUnsavedChanges)

  // 仅在首次加载文章时写入编辑器内容；之后修改元信息也会更新 post，
  // 若每次都 setContent 会用旧草稿覆盖用户尚未保存的编辑
  const loadedPostIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editor)
      return
    if (!post || loadedPostIdRef.current === post.id)
      return
    const content = post.draftContent || post.content || ''
    const t = window.setTimeout(() => {
      editor.commands.setContent(content)
      savedHtmlRef.current = editor.getHTML()
      loadedPostIdRef.current = post.id
    }, 0)
    return () => window.clearTimeout(t)
  }, [post, editor])

  // 被其他编辑会话顶掉后只读
  const isTakenOver = editSession.status === 'taken_over'
  useEffect(() => {
    editor?.setEditable(!isTakenOver)
  }, [editor, isTakenOver])

  // 接管编辑：重新申请会话并加载服务端最新内容（本地未保存的内容以服务端为准）
  const handleTakeOver = useCallback(async () => {
    if (!editor || !(await editSession.takeOver()))
      return
    const latest = await getPostById({ id, type: 'draft' })
      .then(res => res.data)
      .catch(() => null)
    if (!latest) {
      toast.error(t('load_failed'))
      return
    }
    editor.commands.setContent(latest.draftContent || latest.content || '')
    savedHtmlRef.current = editor.getHTML()
    setPost(latest)
  }, [editor, editSession, id, t])

  const onPostUpdate = ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
    setPost(prev => (prev ? { ...prev, ...post } : prev))
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <span>{t('load_failed')}</span>
        <Button size="sm" variant="outline" onClick={loadPost}>{t('retry')}</Button>
      </div>
    )
  }

  if (!post || !editor)
    return <div className="py-20 text-center text-muted-foreground">{t('loading')}</div>

  return (
    // 这里设置一个确定高度（示例使用 80vh），保证内部 SimpleEditor 可在自身内滚动
    <div
      className="w-auto editor-container
    h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6.5rem)]
    md:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6rem)]
    lg:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-5.5rem)]
    "
    >
      <EditorNavbar
        editor={editor}
        post={post}
        onPostUpdate={onPostUpdate}
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

function EditorNavbar({
  editor,
  post,
  onPostUpdate,
  editSession,
  savedHtmlRef,
}: {
  post: Post
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  editor: Editor
  editSession: ReturnType<typeof useEditSession>
  savedHtmlRef: React.RefObject<string | null>
}) {
  const t = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [settingDialogOpen, setSettingDialogOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const onFullscreenError = useCallback(() => toast.error(t('fullscreen_failed')), [t])
  const { isFullScreen, toggleFullScreen } = useFullscreen(onFullscreenError)

  const { sessionId, status: sessionStatus, markTakenOver, check: checkEditSession } = editSession
  // 被顶掉或会话申请中不保存；申请失败时（如后端未更新）退化为不带会话保存
  const canSave = sessionStatus === 'active' || sessionStatus === 'error'

  // 保存草稿函数
  const saveDraft = useCallback(
    (showToast: boolean) => {
      if (!canSave)
        return Promise.resolve()
      const htmlToSave = editor.getHTML()
      setSavingDraft(true)
      return updatePost({ post: { id: post.id, draftContent: htmlToSave }, editSessionId: sessionId })
        .then(() => {
          savedHtmlRef.current = htmlToSave
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
        .finally(() => {
          setSavingDraft(false)
        })
    },
    [canSave, post.id, editor, sessionId, savedHtmlRef, operationT, markTakenOver],
  )

  // 定时保存：内容有变化才保存，没有变化时只检查编辑会话是否仍有效
  useEffect(() => {
    const AUTOSAVE_MS = 10_000
    const iv = setInterval(() => {
      if (editor.getHTML() === savedHtmlRef.current)
        checkEditSession()
      else
        saveDraft(false)
    }, AUTOSAVE_MS)
    return () => clearInterval(iv)
  }, [editor, saveDraft, savedHtmlRef, checkEditSession])

  // 快捷键保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveDraft(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [post, editor, saveDraft])

  // 发布：草稿与正文一起提交
  const publishPost = () => {
    if (!canSave || publishing)
      return
    const htmlToPublish = editor.getHTML()
    setPublishing(true)
    updatePost({
      post: {
        id: post.id,
        draftContent: htmlToPublish,
        content: htmlToPublish,
        type: 'html',
      },
      editSessionId: sessionId,
    })
      .then(() => {
        savedHtmlRef.current = htmlToPublish
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
      .finally(() => setPublishing(false))
  }

  // 预览点击
  const onPreview = () => saveDraft(true)

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <span
            className="text-lg font-semibold truncate block"
            title={post.title || t('untitled')}
          >
            {post.title || t('untitled')}
          </span>
        </div>
        {lastSavedAt && (
          <LastSavedAt time={lastSavedAt} className="text-sm text-muted-foreground w-full md:w-auto" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CreateOrUpdatePostMetaDialogWithoutButton
          open={settingDialogOpen}
          onOpenChange={setSettingDialogOpen}
          post={post}
          onPostChange={onPostUpdate}
        />
        {/* source mode removed */}
        <Button
          size="sm"
          onClick={toggleFullScreen}
          variant="outline"
          aria-label={isFullScreen ? t('fullscreen_exit') : t('fullscreen_enter')}
          title={isFullScreen ? t('fullscreen_exit') : t('fullscreen_enter')}
        >
          {isFullScreen
            ? (
                <MinimizeIcon className="size-4" />
              )
            : (
                <FullscreenIcon className="size-4" />
              )}
        </Button>
        <PostPreviewDialogWithButton post={post} onPreview={onPreview} />
        <Button size="sm" onClick={() => setSettingDialogOpen(true)} variant="outline">
          {t('setting')}
        </Button>
        <Button size="sm" onClick={() => saveDraft(true)} variant="outline" disabled={savingDraft || !canSave}>
          {savingDraft ? t('saving_draft') : t('save_draft')}
        </Button>
        <Button size="sm" onClick={publishPost} disabled={!canSave || publishing}>
          {publishing ? t('publishing') : operationT('publish')}
        </Button>
      </div>
    </div>
  )
}
