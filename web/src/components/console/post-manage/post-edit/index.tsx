'use client'
// InitializedMDXEditor.tsx
import { useEffect, useRef, useState, type ForwardedRef } from 'react'
import {
  type MDXEditorMethods
} from '@mdxeditor/editor'
import { Post } from '@/models/post'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Bold, Italic, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { getPostById, updatePost } from '@/api/post'
import { toast } from 'sonner'
import { InitializedMDXEditor } from './mdx-editor'

export function PostEdit() {
  const { id } = useParams() as { id: string };
  const [post, setPost] = useState<Post | null>(null);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getPostById({ id, type: "draft" }).then(res => {
      setPost(res.data);
    });
  }, [id]);

  const onPostUpdate = (meta: Partial<Post>) => {
    setPost(prev => prev ? { ...prev, ...meta } : prev);
  }

  if (!post) return <div>Loading...</div>;

  return (
    <div>
      <EditorNavbar editorRef={editorRef} post={post} onPostUpdate={onPostUpdate} />
      <div ref={wrapperRef} className="mt-4 border-1 rounded-sm relative overflow-hidden">
        <InitializedMDXEditor
          className="typography"
          editorRef={editorRef}
          markdown={post?.draftContent || ''}
        />
      </div>
    </div>
  )
}

function EditorNavbar({ editorRef, post, onPostUpdate }: { post: Post, onPostUpdate: (meta: Partial<Post>) => void, editorRef: ForwardedRef<MDXEditorMethods> | null }) {
  const t = useTranslations("Console.post_edit")
  const operationT = useTranslations("Operation")
  const saveDraft = () => {
    const markdown = editorRef && 'current' in editorRef && editorRef.current ? editorRef.current.getMarkdown() : '';
    updatePost({ post: { id: post.id, draftContent: markdown } }).then(() => {
      toast.success(operationT("save_success"));
    }).catch(() => {
      toast.error(operationT("save_failed"));
    });
  }
  const publishPost = () => {
    const markdown = editorRef && 'current' in editorRef && editorRef.current ? editorRef.current.getMarkdown() : '';
    updatePost({ post: { id: post.id, draftContent: markdown, content: markdown } }).then(() => {
      toast.success(operationT("publish_success"));
    }).catch(() => {
      toast.error(operationT("publish_failed"));
    });
  }
  return (
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center space-x-2">
        <span className="text-lg font-semibold">{post.title || t("untitled")}</span>
      </div>
      <div className="flex items-center space-x-2">
        <Button onClick={saveDraft} variant="outline">{t("save_draft")}</Button>
        <Button onClick={publishPost}>{operationT("publish")}</Button>
      </div>
    </div>
  )
}

