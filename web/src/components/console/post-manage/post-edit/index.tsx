'use client'
// InitializedMDXEditor.tsx
import { useEffect, useRef, useState, type ForwardedRef } from 'react'
import {
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  codeBlockPlugin,
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps
} from '@mdxeditor/editor'
import { Post } from '@/models/post'
import '@mdxeditor/editor/style.css'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Bold, Italic, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { getPostById, updatePost } from '@/api/post'
import { PostSettingButtonWithDialog } from './post-meta-dialog-form'
import { toast } from 'sonner'

export function PostEdit() {
  const { id } = useParams() as { id: string };
  const [post, setPost] = useState<Post | null>(null);
  const editorRef = useRef<MDXEditorMethods>(null)

  useEffect(() => {
    getPostById({ id }).then(res => {
      setPost(res.data);
    });
  }, [id]);

  useEffect(() => {
    editorRef.current?.setMarkdown(post?.draftContent || "")
  }, [post?.draftContent])

  if (!post) return null;

  return (
    <div>
      <EditorNavbar editorRef={editorRef} post={post} />
      <EditorToolbar editorRef={editorRef} />
      <div className="mt-4 border-1 rounded-sm">
        <InitializedMDXEditor className="typography" editorRef={editorRef} markdown={post?.draftContent || ''} />
      </div>
    </div>
  )
}


export function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  return (
    <MDXEditor
      plugins={[
        codeBlockPlugin(),
        headingsPlugin(),
        listsPlugin(),
        markdownShortcutPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
      ]}
      {...props}
      ref={editorRef}
    />
  )
}

function EditorNavbar({ editorRef, post }: { post: Post,editorRef: ForwardedRef<MDXEditorMethods> | null }) {
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

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
      </div>
      <div className="flex items-center space-x-2">
        <PostSettingButtonWithDialog post={post} />
        <Button onClick={saveDraft} variant="outline">{t("save_draft")}</Button>
        <Button >{operationT("publish")}</Button>
      </div>
    </div>
  )
}

function EditorToolbar({ editorRef }: { editorRef: ForwardedRef<MDXEditorMethods> | null }) {
  return (
    <div>
      <ToggleGroup variant="outline" type="multiple">
        <ToggleGroupItem value="bold" aria-label="Toggle bold">
          <Bold className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Toggle italic">
          <Italic className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="strikethrough" aria-label="Toggle strikethrough">
          <Underline className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}

