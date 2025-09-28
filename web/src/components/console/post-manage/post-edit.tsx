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
  toolbarPlugin,
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps
} from '@mdxeditor/editor'
import { Post } from '@/models/post'
import '@mdxeditor/editor/style.css'

export function PostEdit({ post }: { post: Post }) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const [content, setContent] = useState(post.content);

  useEffect(() => {
    editorRef.current?.setMarkdown(content || "")
  }, [content])

  return (
    <div>
      编辑器
      <InitializedMDXEditor className="typography" editorRef={editorRef} markdown={content} />
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
        toolbarPlugin(),
      ]}
      {...props}
      ref={editorRef}
    />
  )
}