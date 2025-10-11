'use client'

import type { Editor } from '@tiptap/react'
import { EditorContent, EditorContext } from '@tiptap/react'
import hljs from 'highlight.js'

// --- Tiptap Core Extensions ---

import * as React from 'react'
// --- Components ---
import { ThemeToggle } from '@/components/tiptap-editor/theme-toggle'

import { ImageNodeFloating } from '@/components/tiptap-node/image-node/image-node-floating'
// --- UI Primitives ---
import { Spacer } from '@/components/tiptap-ui-primitive/spacer'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '@/components/tiptap-ui-primitive/toolbar'
import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button'
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button'
import { ColorTextPopover } from '@/components/tiptap-ui/color-text-popover'
// --- Tiptap UI ---
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu'

import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button'
import { LinkPopover } from '@/components/tiptap-ui/link-popover'

import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu'
import { MarkButton } from '@/components/tiptap-ui/mark-button'
import { TextAlignButton } from '@/components/tiptap-ui/text-align-button'
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button'
// --- Tiptap Node ---
import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss'

// --- Icons ---

// --- Hooks ---

import '@/components/tiptap-node/list-node/list-node.scss'

// --- Lib ---

// --- Styles ---

import '@/components/tiptap-node/image-node/image-node.scss'

import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'

import '@/styles/_variables.scss'
import '@/styles/_keyframe-animations.scss'
import 'highlight.js/styles/github-dark.css'

function MainToolbarContent({
  editor,
}: {
  editor: Editor
}) {
  return (
    <>
      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        {/* 使用 portal 渲染，避免下拉影响工具条布局 */}
        <HeadingDropdownMenu levels={[1, 2, 3, 4]} portal={true} />
        <ListDropdownMenu types={['bulletList', 'orderedList', 'taskList']} portal={true} />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />

        <ColorTextPopover
          editor={editor}
          hideWhenUnavailable={true}
        />

        <LinkPopover />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ImageUploadButton text="Add" />
        <ImageNodeFloating />
      </ToolbarGroup>

      <Spacer />

      <ToolbarSeparator />
      <ToolbarGroup>
        <ThemeToggle />
      </ToolbarGroup>
    </>
  )
}

// 移除了移动端独立 Toolbar 内容，统一使用 MainToolbarContent

export function SimpleEditor({ editor }: { editor: Editor }) {
  const toolbarRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    hljs.highlightAll()
  }, [])

  return (
    // h-full 使其填充上层已确定的高度；内部 container 使用 min-h-0 + overflow-auto
    <div className="py-0 flex min-h-0 h-full w-full box-border border-2 border-primary rounded-lg overflow-hidden">
      <EditorContext.Provider value={{ editor }}>
        <div className="max-w-[60rem] w-full mx-auto h-full flex flex-col flex-1 box-border overflow-hidden min-h-0">
          <Toolbar
            ref={toolbarRef}
            className="editor-toolbar sticky top-0 z-10 !bg-primary/5
            backdrop-blur-sm flex items-center gap-3 px-4 py-3 w-full
            p-0 rounded-lg border-1"
            style={{
              WebkitOverflowScrolling: 'touch',
              touchAction: 'auto',
            }}
          >
            <MainToolbarContent
              editor={editor}
            />
          </Toolbar>
          <EditorContent
            editor={editor}
            role="presentation"
            className="tiptap ProseMirror simple-editor flex-1 overflow-auto px-6 py-6 lg:px-10 pb-[30vh] sm:px-6"
          />
        </div>
      </EditorContext.Provider>
    </div>
  )
}
