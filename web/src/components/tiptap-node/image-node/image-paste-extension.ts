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

/**
 * 粘贴剪贴板中的图片文件：在光标处放置上传占位，上传完成后在占位位置插入图片
 * 剪贴板同时带有纯文本时（如从 Word/Excel 复制）保持默认粘贴行为，避免把文字粘成截图
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
            const clipboard = event.clipboardData
            if (!clipboard || clipboard.getData('text/plain').trim())
              return false
            const files = Array.from(clipboard.files).filter(file => file.type.startsWith('image/'))
            if (files.length === 0)
              return false

            event.preventDefault()
            const id = {}
            const tr = view.state.tr
            if (!tr.selection.empty)
              tr.deleteSelection()
            tr.setMeta(imagePastePluginKey, { add: { id, pos: tr.selection.from } } satisfies PlaceholderAction)
            view.dispatch(tr)

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
            return true
          },
        },
      }),
    ]
  },
})

export default ImagePaste
