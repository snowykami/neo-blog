import type { NodeType } from '@tiptap/pm/model'
import { mergeAttributes, Node, ReactNodeViewRenderer } from '@tiptap/react'
import { UploadNode } from './upload-node'

export type UploadFunction = (
  file: File,
  onProgress?: (event: { progress: number }) => void,
  abortSignal?: AbortSignal,
) => Promise<string>

/** 占位块的媒体类型：决定图标、文案，以及上传完成后插入的节点 */
export type UploadMediaType = 'image' | 'video'

export interface UploadNodeOptions {
  /**
   * The type of the node to insert after upload.
   * @default 'image'
   */
  type?: string | NodeType | undefined
  /**
   * Media kind of the placeholder (icon and labels).
   * @default 'image'
   */
  mediaType?: UploadMediaType
  /**
   * Acceptable file types for upload.
   * @default 'image/*'
   */
  accept?: string
  /**
   * Maximum number of files that can be uploaded.
   * @default 1
   */
  limit?: number
  /**
   * Maximum file size in bytes (0 for unlimited).
   * @default 0
   */
  maxSize?: number
  /**
   * Function to handle the upload process.
   */
  upload?: UploadFunction
  /**
   * Callback for upload errors.
   */
  onError?: (error: Error) => void
  /**
   * Callback for successful uploads.
   */
  onSuccess?: (url: string) => void
  /**
   * HTML attributes to add to the placeholder element.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, unknown>
}

export interface UploadNodeConfig {
  /** 节点名，与 parseHTML 的 data-type 对应（图片沿用 imageUpload，兼容旧内容） */
  name: 'imageUpload' | 'videoUpload'
  /** 占位块的 data-type，用于从 HTML 还原 */
  dataType: string
  /** 媒体类型：决定占位块的图标与文案 */
  mediaType: UploadMediaType
  /** 上传完成后插入的节点类型 */
  nodeType: string
  /** 可接受的文件类型 */
  accept: string
}

/**
 * 上传占位块：在光标处显示拖拽 / 选择文件的区域，上传完成后用返回的地址插入对应节点。
 * 图片与视频共用同一实现，只有节点名、可接受类型与文案不同。
 */
export function createUploadNode(config: UploadNodeConfig) {
  return Node.create<UploadNodeOptions>({
    name: config.name,

    group: 'block',

    draggable: true,

    selectable: true,

    atom: true,

    addOptions() {
      return {
        type: config.nodeType,
        mediaType: config.mediaType,
        accept: config.accept,
        limit: 1,
        maxSize: 0,
        upload: undefined,
        onError: undefined,
        onSuccess: undefined,
        HTMLAttributes: {},
      }
    },

    addAttributes() {
      return {
        accept: {
          default: this.options.accept,
        },
        limit: {
          default: this.options.limit,
        },
        maxSize: {
          default: this.options.maxSize,
        },
        // 拖入文件时由插入方暂存的待上传文件（见 upload-queue.ts），只在内存中有效，不写入 HTML
        uploadId: {
          default: null,
          rendered: false,
          parseHTML: () => null,
        },
      }
    },

    parseHTML() {
      return [{ tag: `div[data-type="${config.dataType}"]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes({ 'data-type': config.dataType }, HTMLAttributes)]
    },

    addNodeView() {
      return ReactNodeViewRenderer(UploadNode)
    },

    // 选中占位块后按 Enter 触发文件选择（与点击占位区域一致）
    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const { selection } = editor.state
          if (!editor.isActive(config.name))
            return false
          const nodeEl = editor.view.nodeDOM(selection.from)
          if (nodeEl && nodeEl instanceof HTMLElement) {
            // NodeViewWrapper 外面还有一层 div，点击第一层子元素
            const firstChild = nodeEl.firstChild
            if (firstChild && firstChild instanceof HTMLElement) {
              firstChild.click()
              return true
            }
          }
          return false
        },
      }
    },
  })
}

/** 图片上传占位块：接受 image/*，上传后插入 image 节点 */
export const ImageUploadNode = createUploadNode({
  name: 'imageUpload',
  dataType: 'image-upload',
  mediaType: 'image',
  nodeType: 'image',
  accept: 'image/*',
})

/** 视频上传占位块：接受 video/*，上传后插入 video 节点 */
export const VideoUploadNode = createUploadNode({
  name: 'videoUpload',
  dataType: 'video-upload',
  mediaType: 'video',
  nodeType: 'video',
  accept: 'video/*',
})
