import type { AnyExtension } from '@tiptap/react'
import type { SlashCommandItem } from '@/components/tiptap-extension/slash-command-extension'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Highlight } from '@tiptap/extension-highlight'
import { HorizontalRule } from '@tiptap/extension-horizontal-rule'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { Focus, Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { AIWriteHighlight } from '@/components/tiptap-extension/ai-write-extension'
import { Annotation, LinkAutoMatch } from '@/components/tiptap-extension/annotation-extension'
import { EditorShortcuts } from '@/components/tiptap-extension/editor-shortcuts-extension'
import { InlineCode } from '@/components/tiptap-extension/inline-code-extension'
import { SelectionHighlight } from '@/components/tiptap-extension/selection-highlight-extension'
import { SlashCommand } from '@/components/tiptap-extension/slash-command-extension'
import { ComponentBlock } from '@/components/tiptap-node/component-block-node'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImagePaste } from '@/components/tiptap-node/image-node/image-paste-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import { MAX_FILE_SIZE } from '@/lib/tiptap-utils'

const lowlight = createLowlight(common)

export interface ContentExtensionsOptions {
  // 上传图片并返回地址，失败时返回空字符串（由调用方负责提示）
  upload: (file: File) => Promise<string>
  // 空段落 / 空标题的占位文案
  placeholder: (props: { nodeName: string, level?: number }) => string
  // 斜杠命令的候选项（按输入过滤，文案已本地化）
  getSlashItems: (query: string) => SlashCommandItem[]
  // 快捷键：Mod-k 打开链接编辑、Mod-Alt-m 打开注释编辑
  onOpenLink?: () => void
  onOpenAnnotation?: () => void
  // 快捷键：Mod-j 打开 AI 写作
  onOpenAI?: () => void
}

/**
 * 文章与页面编辑器共用的扩展列表
 * 输出的 HTML 结构（图片 figure、注释 span、分割线等）需与前台渲染保持一致，修改时注意兼容旧内容
 */
export function createContentExtensions(options: ContentExtensionsOptions): AnyExtension[] {
  const { upload, placeholder, getSlashItems, onOpenLink, onOpenAnnotation, onOpenAI } = options
  return [
    StarterKit.configure({
      horizontalRule: false,
      // 代码块使用 lowlight 高亮版本
      codeBlock: false,
      // 行内代码换成可叠加链接与注释的版本
      code: false,
      link: {
        openOnClick: false,
        enableClickSelection: true,
      },
      dropcursor: { width: 2, class: 'neo-editor-dropcursor' },
    }),
    InlineCode,
    HorizontalRule,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // 文字颜色由 TextStyleKit 内置的 Color 提供（types 固定为 textStyle），不要重复注册
    TextStyleKit.configure({ color: { types: ['textStyle'] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Image,
    Annotation,
    LinkAutoMatch,
    // 打开注释、链接等弹窗时保留选区高亮
    SelectionHighlight,
    // 粘贴图片时按默认压缩等级上传并插入到光标处
    ImagePaste.configure({ upload }),
    Typography,
    Superscript,
    Subscript,
    CodeBlockLowlight.configure({ lowlight }),
    // 表格：不启用列宽拖拽，输出普通的 table 结构，与前台渲染一致
    TableKit.configure({ table: { resizable: false } }),
    // 组件块：注册表中的内置 React 组件，正文只保存组件名与 JSON props
    ComponentBlock,
    ImageUploadNode.configure({
      accept: 'image/*',
      maxSize: MAX_FILE_SIZE,
      limit: 3,
      upload,
      onError: error => console.error('Upload failed:', error),
    }),
    Placeholder.configure({
      includeChildren: false,
      placeholder: ({ node }) => placeholder({ nodeName: node.type.name, level: node.attrs.level }),
    }),
    // 专注模式下淡化非当前块
    Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
    SlashCommand.configure({ getItems: getSlashItems }),
    EditorShortcuts.configure({ onOpenLink, onOpenAnnotation, onOpenAI }),
    // AI 写作的目标位置与生成内容高亮
    AIWriteHighlight,
  ]
}
