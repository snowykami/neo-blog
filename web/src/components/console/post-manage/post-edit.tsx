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
import { Input } from '@/components/ui/input'
import { useParams } from 'next/navigation'
import { getPostById } from '@/api/post'

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
    editorRef.current?.setMarkdown(post?.content || "")
  }, [post?.content])

  return (
    <div>
      <EditorNavbar editorRef={editorRef} />
      <EditorToolbar editorRef={editorRef} />
      <div className="mt-4 border-1 rounded-sm">
        <InitializedMDXEditor className="typography" editorRef={editorRef} markdown={post?.content || ''} />
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

function EditorNavbar({ editorRef }: { editorRef: ForwardedRef<MDXEditorMethods> | null }) {
  const t = useTranslations("Console.post_edit")
  const operationT = useTranslations("Operation")
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Input placeholder={t("title_placeholder")} />
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="outline">{operationT("setting")}</Button>
        <Button variant="outline">{t("save_draft")}</Button>
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