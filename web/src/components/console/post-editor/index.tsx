'use client'
// InitializedMDXEditor.tsx
import { useCallback, useEffect, useState } from 'react'
import { Post } from '@/models/post'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { getPostById, updatePost } from '@/api/post'
import { toast } from 'sonner'
import { Editor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { SimpleEditor } from '@/components/tiptap-templates/simple/simple-editor'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import TextAlign from '@tiptap/extension-text-align'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Typography from '@tiptap/extension-typography'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { Highlight } from "@tiptap/extension-highlight"
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { uploadFile } from '@/api/file'
import Color from "@tiptap/extension-color"
import { CreateOrUpdatePostMetaDialogWithoutButton } from "../common/post-meta-dialog-form";


export function PostEditor() {
  const { id } = useParams() as { id: string };
  const [post, setPost] = useState<Post | null>(null);

  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const res = await uploadFile({ file })
      return res.data.url
    } catch {
      toast.error("Image upload failed")
      return ""
    }
  }, []);

  // Tiptap editor
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "simple-editor",
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
      Color.configure({ types: ["textStyle"] }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Superscript,
      Subscript,
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error) => console.error("Upload failed:", error),
      }),
    ],
  })

  // source mode removed; always use rich text editor

  useEffect(() => {
    getPostById({ id, type: "draft" }).then(res => {
      console.log()
      setPost(res.data);
    });
  }, [id]);

  useEffect(() => {
    if (!editor) return;
    if (!post) return;
    const content = post.draftContent || post.content || '<p>Empty</p>';
    const t = window.setTimeout(() => {
      editor.commands.setContent(content);
    }, 0);
    return () => window.clearTimeout(t);
  }, [post, editor]);

  const onPostUpdate = ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => {
    setPost(prev => prev ? { ...prev, ...post } : prev);
  }

  if (!post || !editor) return <div>Loading...</div>;

  return (
    <div className='w-auto'>
      <EditorNavbar editor={editor} post={post} onPostUpdate={onPostUpdate} />
      <div className="relative mt-4">
        <SimpleEditor editor={editor} />
      </div>
    </div>
  )
}

function EditorNavbar({ editor, post, onPostUpdate }: { post: Post, onPostUpdate: ({ post }: { post: Partial<Post> & Pick<Post, "id"> }) => void, editor: Editor }) {
  const t = useTranslations("Console.post_edit")
  const operationT = useTranslations("Operation")
  const [savingDraft, setSavingDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [settingDialogOpen, setSettingDialogOpen] = useState(false);

  const saveDraft = useCallback((showToast: boolean) => {
    const htmlToSave = editor.getHTML();
    setSavingDraft(true);
    updatePost({ post: { id: post.id, draftContent: htmlToSave } }).then(() => {
      if (showToast) toast.success(operationT("save_success"));
      setLastSavedAt(new Date());
    }).catch(() => {
      toast.error(operationT("save_failed"));
    }).finally(() => {
      setSavingDraft(false);
    });
  }, [post, editor, operationT]);

  // 定时保存
  useEffect(() => {
    const AUTOSAVE_MS = 10_000;
    const iv = setInterval(() => {
      if (!post) return;
      saveDraft(false);
    }, AUTOSAVE_MS);
    return () => clearInterval(iv);
  }, [post, editor, saveDraft]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDraft(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [post, editor, saveDraft]);

  const publishPost = () => {
    const htmlToPublish = editor.getHTML();
    updatePost({ post: { id: post.id, draftContent: htmlToPublish, content: htmlToPublish, type: "html" } }).then(() => {
      toast.success(operationT("publish_success"));
    }).catch(() => {
      toast.error(operationT("publish_failed"));
    });
  }

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-1 gap-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold break-words">{post.title || t("untitled")}</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {lastSavedAt && <span className="text-sm text-muted-foreground w-full md:w-auto">{t("last_saved_at", { time: lastSavedAt.toLocaleTimeString() })}</span>}
        <CreateOrUpdatePostMetaDialogWithoutButton open={settingDialogOpen} onOpenChange={setSettingDialogOpen} post={post} onPostChange={onPostUpdate} />
        {/* source mode removed */}
        <Button onClick={() => setSettingDialogOpen(true)} variant="outline">{t("setting")}</Button>
        <Button onClick={() => saveDraft(true)} variant="outline" disabled={savingDraft}>{savingDraft ? t("saving_draft") : t("save_draft")}</Button>
        <Button onClick={publishPost}>{operationT("publish")}</Button>
      </div>
    </div>
  )
}

