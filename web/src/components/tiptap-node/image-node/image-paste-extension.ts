import type { EditorView } from '@tiptap/pm/view'
import type { UploadFunction } from '@/components/tiptap-node/upload-node/upload-node-extension'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'
import { queueUploadFiles } from '@/components/tiptap-node/upload-node/upload-queue'

export interface ImagePasteOptions {
  // 上传文件并返回地址，失败或取消时返回空字符串（由调用方负责提示）；signal 用于占位被删除时取消上传
  upload: UploadFunction
}

export interface ImagePasteStorage {
  // 拖入了编辑器不支持的文件时调用（由编辑页设置，负责本地化提示）
  onUnsupportedFiles: ((files: File[]) => void) | null
}

declare module '@tiptap/react' {
  interface Storage {
    imagePaste: ImagePasteStorage
  }
}

type PlaceholderAction = { add: { id: object, pos: number } } | { remove: { id: object } }

const imagePastePluginKey = new PluginKey<DecorationSet>('imagePaste')

// 查找占位装饰当前所在位置，期间文档的增删会通过 mapping 自动修正位置
function findPlaceholder(view: EditorView, id: object): number | null {
  const decorations = imagePastePluginKey.getState(view.state)
  const found = decorations?.find(undefined, undefined, spec => spec.id === id)
  return found?.length ? found[0].from : null
}

/** 剪贴板 / 拖拽数据里的全部文件（有的浏览器只写 items 不写 files） */
export function filesOf(data: DataTransfer | null): File[] {
  if (!data)
    return []
  const files = Array.from(data.files ?? [])
  return files.length > 0
    ? files
    : Array.from(data.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
}

/** 剪贴板 / 拖拽数据里的图片文件；同时带有文字内容时（如从 Word、网页复制）交给默认处理 */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data || data.getData('text/plain').trim())
    return []
  return filesOf(data).filter(file => file.type.startsWith('image/'))
}

export interface DropRoute {
  images: File[]
  videos: File[]
  unsupported: File[]
  /** 是否由我们处理（拦下浏览器默认行为）；为 false 时交给 ProseMirror / 浏览器默认处理 */
  handled: boolean
}

/**
 * 拖入文件的分流：按 dataTransfer.files 判断，不看是否带有文字（从网页拖图片时会带上图片地址）
 * - 图片走上传占位，视频交给视频上传占位块（带进度与取消）
 * - 只有不支持的文件时：带有网页内容（HTML / 文字）的交给默认处理（按 HTML 插入），否则提示不支持，
 *   并拦下浏览器默认行为（否则会导航到该文件）
 * - 没有文件（拖文字、链接）交给默认处理
 */
export function routeDroppedFiles(data: DataTransfer | null): DropRoute {
  const files = filesOf(data)
  const images = files.filter(file => file.type.startsWith('image/'))
  const videos = files.filter(file => file.type.startsWith('video/'))
  const unsupported = files.filter(file => !images.includes(file) && !videos.includes(file))
  let handled = images.length > 0 || videos.length > 0
  if (!handled && unsupported.length > 0) {
    const hasWebContent = Boolean(data?.getData('text/html').trim() || data?.getData('text/plain').trim())
    handled = !hasWebContent
  }
  return { images, videos, unsupported: handled ? unsupported : [], handled }
}

/**
 * 图片的粘贴与拖入：从剪贴板或桌面拖进来图片文件时，在落点处显示上传占位，上传完成后插入图片；拖入视频时插入视频上传占位块
 * - 剪贴板同时带有纯文本时（如从 Word/Excel 复制）保持默认粘贴行为，避免把文字粘成截图
 * - 占位所在内容被删除（删除、撤销）或编辑器销毁时取消上传，避免上传在后台跑完后留下无人引用的文件
 */
export const ImagePaste = Extension.create<ImagePasteOptions, ImagePasteStorage>({
  name: 'imagePaste',

  addOptions() {
    return {
      upload: async () => '',
    }
  },

  addStorage() {
    return {
      onUnsupportedFiles: null,
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    const { upload } = this.options
    const storage = this.storage
    // 进行中的上传：占位 id → 取消用的 controller
    const uploads = new Map<object, AbortController>()

    // 占位已存在时的上传流程：占位位置随文档变化由 decoration 的 mapping 维护
    const uploadAt = (view: EditorView, id: object, files: File[]) => {
      const controller = new AbortController()
      uploads.set(id, controller)
      Promise.all(files.map(file => upload(file, undefined, controller.signal).catch(() => '')))
        .then((urls) => {
          uploads.delete(id)
          // 已取消（占位被删除、编辑器已销毁）时上传结果由上传函数负责清理
          if (controller.signal.aborted || editor.isDestroyed)
            return
          const pos = findPlaceholder(view, id)
          view.dispatch(view.state.tr.setMeta(imagePastePluginKey, { remove: { id } } satisfies PlaceholderAction))
          const images = urls.filter(Boolean).map(src => ({ type: 'image', attrs: { src } }))
          if (pos === null || images.length === 0)
            return
          editor.chain().insertContentAt(pos, images).run()
        })
    }

    const addPlaceholder = (view: EditorView, pos: number, files: File[], deleteSelection = false) => {
      const id = {}
      const tr = view.state.tr
      if (deleteSelection && !tr.selection.empty)
        tr.deleteSelection()
      tr.setMeta(imagePastePluginKey, { add: { id, pos: deleteSelection ? tr.selection.from : pos } } satisfies PlaceholderAction)
      view.dispatch(tr)
      uploadAt(view, id, files)
    }

    return [
      new Plugin<DecorationSet>({
        key: imagePastePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            set = set.map(tr.mapping, tr.doc)
            const action = tr.getMeta(imagePastePluginKey) as PlaceholderAction | undefined
            if (action && 'add' in action) {
              const widget = document.createElement('span')
              widget.className = 'tiptap-image-paste-placeholder'
              set = set.add(tr.doc, [Decoration.widget(action.add.pos, widget, { id: action.add.id })])
            }
            else if (action && 'remove' in action) {
              set = set.remove(set.find(undefined, undefined, spec => spec.id === action.remove.id))
            }
            return set
          },
        },
        // 占位所在内容被删除时 mapping 会丢掉装饰：此时取消对应的上传；编辑器销毁时取消全部
        view: () => ({
          update: (view) => {
            uploads.forEach((controller, id) => {
              if (findPlaceholder(view, id) === null) {
                uploads.delete(id)
                controller.abort()
              }
            })
          },
          destroy: () => {
            uploads.forEach(controller => controller.abort())
            uploads.clear()
          },
        }),
        props: {
          decorations: state => imagePastePluginKey.getState(state),
          handlePaste: (view, event) => {
            const files = imageFilesOf(event.clipboardData)
            if (files.length === 0)
              return false

            event.preventDefault()
            addPlaceholder(view, view.state.selection.from, files, true)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            // 编辑器内部拖动（移动块、拖文字）交给 ProseMirror
            if (moved)
              return false
            const route = routeDroppedFiles(event.dataTransfer)
            if (!route.handled)
              return false
            // 拦下浏览器默认行为：插入会被写成 blob: 地址，其余类型会被导航到该文件；只读态下也不让浏览器跳离当前编辑页
            event.preventDefault()
            if (!view.editable)
              return true
            if (route.unsupported.length > 0)
              storage.onUnsupportedFiles?.(route.unsupported)
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!at)
              return true
            const videoUpload = view.state.schema.nodes.videoUpload
            if (route.videos.length > 0 && videoUpload) {
              // 视频占位块一次上传一个：每个视频一个占位块，挂载后取走文件开始上传
              editor.chain().insertContentAt(at.pos, route.videos.map(file => ({
                type: videoUpload.name,
                attrs: { uploadId: queueUploadFiles([file]) },
              }))).run()
            }
            else if (route.videos.length > 0) {
              storage.onUnsupportedFiles?.(route.videos)
            }
            if (route.images.length > 0)
              addPlaceholder(view, at.pos, route.images)
            return true
          },
        },
      }),
    ]
  },
})

export default ImagePaste
