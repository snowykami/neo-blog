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
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { uploadFile } from '@/api/file'
import { getPostById, updatePost } from '@/api/post'
import { CreateOrUpdatePostMetaDialogWithoutButton } from '@/components/console/common/post-meta-dialog-form'
import { SimpleEditor } from '@/components/tiptap-editor/simple-editor'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { Button } from '@/components/ui/button'
import { useOperationT } from '@/hooks/use-translations'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'
import { PostPreviewDialogWithButton } from './post-preview'

const lowlight = createLowlight(common)

export function PostEditor() {
  const { id } = useParams() as { id: string }
  const [post, setPost] = useState<Post | null>(null)

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

  // Tiptap editor
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'autocomplete': 'off',
        'autocorrect': 'off',
        'autocapitalize': 'off',
        'aria-label': 'Main content area, start typing to enter text.',
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

  useEffect(() => {
    getPostById({ id, type: 'draft' }).then((res) => {
      setPost(res.data)
    })
  }, [id])

  useEffect(() => {
    if (!editor)
      return
    if (!post)
      return
    const content = post.draftContent || post.content || '<p>Empty</p>'
    const t = window.setTimeout(() => {
      editor.commands.setContent(content)
    }, 0)
    return () => window.clearTimeout(t)
  }, [post, editor])

  const onPostUpdate = ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => {
    setPost(prev => (prev ? { ...prev, ...post } : prev))
  }

  if (!post || !editor)
    return <div>Loading...</div>

  return (
    // 这里设置一个确定高度（示例使用 80vh），保证内部 SimpleEditor 可在自身内滚动
    <div
      className="w-auto editor-container
    h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6.5rem)]
    md:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-6rem)]
    lg:h-[calc(100vh-var(--header-height)-var(--console-content-padding)-5.5rem)]
    "
    >
      <EditorNavbar editor={editor} post={post} onPostUpdate={onPostUpdate} />
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
}: {
  post: Post
  onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, 'id'> }) => void
  editor: Editor
}) {
  const t = useTranslations('Console.post_edit')
  const operationT = useOperationT()
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [settingDialogOpen, setSettingDialogOpen] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  // 保存草稿函数
  const saveDraft = useCallback(
    (showToast: boolean) => {
      const htmlToSave = editor.getHTML()
      setSavingDraft(true)
      updatePost({ post: { id: post.id, draftContent: htmlToSave } })
        .then(() => {
          if (showToast)
            toast.success(operationT('save_success'))
          setLastSavedAt(new Date())
        })
        .catch(() => {
          toast.error(operationT('save_failed'))
        })
        .finally(() => {
          setSavingDraft(false)
        })
    },
    [post, editor, operationT],
  )

  // 定时保存
  useEffect(() => {
    const AUTOSAVE_MS = 10_000
    const iv = setInterval(() => {
      if (!post)
        return
      saveDraft(false)
    }, AUTOSAVE_MS)
    return () => clearInterval(iv)
  }, [post, editor, saveDraft])

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

  // 发布
  const publishPost = () => {
    const htmlToPublish = editor.getHTML()
    saveDraft(false)
    updatePost({
      post: {
        id: post.id,
        draftContent: htmlToPublish,
        content: htmlToPublish,
        type: 'html',
      },
    })
      .then(() => {
        toast.success(operationT('publish_success'))
      })
      .catch(() => {
        toast.error(operationT('publish_failed'))
      })
  }

  // 切换全屏
  const handleToggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        toast.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`)
      })
      setIsFullScreen(true)
    }
    else {
      document.exitFullscreen()
      setIsFullScreen(false)
    }
  }

  // 预览点击
  const onPreview = () => {
    saveDraft(true)
  }

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
          <span className="text-sm text-muted-foreground w-full md:w-auto">
            {t('last_saved_at', { time: lastSavedAt.toLocaleTimeString() })}
          </span>
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
        <Button size="sm" onClick={handleToggleFullScreen} variant="outline">
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
        <Button size="sm" onClick={() => saveDraft(true)} variant="outline" disabled={savingDraft}>
          {savingDraft ? t('saving_draft') : t('save_draft')}
        </Button>
        <Button size="sm" onClick={publishPost}>
          {operationT('publish')}
        </Button>
      </div>
    </div>
  )
}
