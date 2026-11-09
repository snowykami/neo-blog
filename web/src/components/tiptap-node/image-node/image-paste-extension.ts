import type { EditorView } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Extension } from '@tiptap/react'

export interface ImagePasteOptions {
  // 上传图片并返回图片地址，失败时返回空字符串（由调用方负责提示）
  upload: (file: File) => Promise<string>
}

type PlaceholderAction = { add: { id: object, pos: number } } | { remove: { id: object } }

const imagePastePluginKey = new PluginKey<DecorationSet>('imagePaste')

// 查找占位装饰当前所在位置，期间文档的增删会通过 mapping 自动修正位置
function findPlaceholder(view: EditorView, id: object): number | null {
  const decorations = imagePastePluginKey.getState(view.state)
  const found = decorations?.find(undefined, undefined, spec => spec.id === id)
  return found?.length ? found[0].from : null
}

/** 剪贴板 / 拖拽数据里的图片文件；同时带有文字内容时（如从 Word、网页复制）交给默认处理 */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data)
    return []
  if (data.getData('text/plain').trim())
    return []
  const files = Array.from(data.files ?? [])
  const all = files.length > 0
    ? files
    : Array.from(data.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
  return all.filter(file => file.type.startsWith('image/'))
}

/**
 * 图片的粘贴与拖入：从剪贴板或桌面拖进来图片文件时，在落点处显示上传占位，上传完成后插入图片
 * - 剪贴板同时带有纯文本时（如从 Word/Excel 复制）保持默认粘贴行为，避免把文字粘成截图
 * - 拖入文件一律拦下（交给我们处理），否则浏览器会把文件插成 blob: 图片或直接导航到该文件
 */
export const ImagePaste = Extension.create<ImagePasteOptions>({
  name: 'imagePaste',

  addOptions() {
    return {
      upload: async () => '',
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    const { upload } = this.options

    // 占位已存在时的上传流程：占位位置随文档变化由 decoration 的 mapping 维护
    const uploadAt = (view: EditorView, id: object, files: File[]) => {
      Promise.all(files.map(file => upload(file).catch(() => '')))
        .then((urls) => {
          const pos = findPlaceholder(view, id)
          view.dispatch(view.state.tr.setMeta(imagePastePluginKey, { remove: { id } } satisfies PlaceholderAction))
          const images = urls.filter(Boolean).map(src => ({ type: 'image', attrs: { src } }))
          // 占位所在内容已被删除时放弃插入
          if (pos === null || images.length === 0 || editor.isDestroyed)
            return
          editor.chain().insertContentAt(pos, images).run()
        })
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
        props: {
          decorations: state => imagePastePluginKey.getState(state),
          handlePaste: (view, event) => {
            const files = imageFilesOf(event.clipboardData)
            if (files.length === 0)
              return false

            event.preventDefault()
            const id = {}
            const tr = view.state.tr
            if (!tr.selection.empty)
              tr.deleteSelection()
            tr.setMeta(imagePastePluginKey, { add: { id, pos: tr.selection.from } } satisfies PlaceholderAction)
            view.dispatch(tr)
            uploadAt(view, id, files)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            // 编辑器内部拖动（移动块、拖文字）交给 ProseMirror
            if (moved || !view.editable)
              return false
            const data = event.dataTransfer
            const files = Array.from(data?.files ?? [])
            if (files.length === 0)
              return false
            // 文件一律不让浏览器处理：插入会被写成 blob: 地址，其余类型会被导航到该文件
            event.preventDefault()
            const images = imageFilesOf(data)
            const at = images.length > 0 ? view.posAtCoords({ left: event.clientX, top: event.clientY }) : null
            if (!at)
              return true
            const id = {}
            view.dispatch(view.state.tr.setMeta(imagePastePluginKey, { add: { id, pos: at.pos } } satisfies PlaceholderAction))
            uploadAt(view, id, images)
            return true
          },
        },
      }),
    ]
  },
})

export default ImagePaste
