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
import { ContentFont } from '@/components/tiptap-extension/content-font-extension'
import { EditorShortcuts } from '@/components/tiptap-extension/editor-shortcuts-extension'
import { HdrText } from '@/components/tiptap-extension/hdr-text-extension'
import { InlineCode } from '@/components/tiptap-extension/inline-code-extension'
import { RemoteChangeHighlight } from '@/components/tiptap-extension/remote-change-extension'
import { SelectionHighlight } from '@/components/tiptap-extension/selection-highlight-extension'
import { SlashCommand } from '@/components/tiptap-extension/slash-command-extension'
import { ComponentBlock } from '@/components/tiptap-node/component-block-node'
import Image from '@/components/tiptap-node/image-node/image-node-extension'
import { ImagePaste } from '@/components/tiptap-node/image-node/image-paste-extension'
import { InlineIcon } from '@/components/tiptap-node/inline-icon-node'
import { createMathExtensions, skipInOpenMath } from '@/components/tiptap-node/math-node'
import { ImageUploadNode, VideoUploadNode } from '@/components/tiptap-node/upload-node'
import Video from '@/components/tiptap-node/video-node/video-node-extension'
import { MAX_FILE_SIZE, MAX_VIDEO_FILE_SIZE } from '@/lib/tiptap-utils'

const lowlight = createLowlight(common)

export interface ContentExtensionsOptions {
  // 上传图片 / 视频并返回地址，失败时返回空字符串（由调用方负责提示）
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
  // 打开公式编辑弹层（点击公式、插入公式后）；pos 为公式节点的位置
  onEditMath?: (pos: number) => void
  // 打开图标选择器更换图标（点击图标、选中图标后按 Enter）；pos 为图标节点的位置
  onEditIcon?: (pos: number) => void
}

/**
 * 文章与页面编辑器共用的扩展列表
 * 输出的 HTML 结构（图片 / 视频 figure、注释 span、分割线等）需与前台渲染保持一致，修改时注意兼容旧内容
 */
export function createContentExtensions(options: ContentExtensionsOptions): AnyExtension[] {
  const { upload, placeholder, getSlashItems, onOpenLink, onOpenAnnotation, onOpenAI, onEditMath, onEditIcon } = options
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
    // 文字颜色由 TextStyleKit 内置的 Color 提供（types 固定为 textStyle），不要重复注册；
    // 关闭内置的 FontFamily，避免粘贴进来的任意 font-family 写入正文，字体改用 ContentFont 按字体键保存
    TextStyleKit.configure({ color: { types: ['textStyle'] }, fontFamily: false }),
    ContentFont,
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Image,
    Video,
    Annotation,
    LinkAutoMatch,
    // 打开注释、链接等弹窗时保留选区高亮
    SelectionHighlight,
    // 粘贴图片时按默认压缩等级上传并插入到光标处
    ImagePaste.configure({ upload }),
    // 排版替换（引号、省略号、箭头等）；正在输入的公式中不替换
    Typography.extend({
      addInputRules() {
        return skipInOpenMath(this.parent?.() ?? [])
      },
    }),
    Superscript,
    Subscript,
    // HDR 文字：在 HDR 屏幕上亮过 SDR 白（前台渲染见 content-hdr-text.tsx）
    HdrText,
    CodeBlockLowlight.configure({ lowlight }),
    // 表格：不启用列宽拖拽，输出普通的 table 结构，与前台渲染一致
    TableKit.configure({ table: { resizable: false } }),
    // 组件块：注册表中的内置 React 组件，正文只保存组件名与 JSON props
    ComponentBlock,
    // 数学公式（LaTeX）：行内 $…$、独立成块 $$…$$，用 KaTeX 渲染
    ...createMathExtensions(onEditMath),
    // 行内图标（lucide）：只保存图标名，大小与颜色跟随文字
    InlineIcon.configure({ onEdit: onEditIcon }),
    ImageUploadNode.configure({
      accept: 'image/*',
      maxSize: MAX_FILE_SIZE,
      limit: 3,
      upload,
      onError: error => console.error('Upload failed:', error),
    }),
    // 视频体积大，一次上传一个，完成后插入 video 节点
    VideoUploadNode.configure({
      accept: 'video/*',
      maxSize: MAX_VIDEO_FILE_SIZE,
      limit: 1,
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
    // 只读观看时远端写入的块高亮
    RemoteChangeHighlight,
  ]
}
