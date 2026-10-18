import type { ImageOptions } from '@tiptap/extension-image'
import { Image as TiptapImage } from '@tiptap/extension-image'
import { mergeAttributes, ReactNodeViewRenderer } from '@tiptap/react'
import { IMAGE_CAPTION_ATTR, IMAGE_FIGURE_CLASS } from './image-node-constants'
import { ImageNodeView } from './image-node-view'

export const Image = TiptapImage.extend<ImageOptions>({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-align': {
        default: null,
      },
      'caption': {
        default: null,
        parseHTML: element => element.querySelector('figcaption')?.textContent?.trim() || null,
        // 注释渲染为 figcaption，不作为 img 属性输出
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: `figure.${IMAGE_FIGURE_CLASS}`,
        // 优先于父级的 img 规则，避免把 figure 内的 img 单独解析、丢失注释
        priority: 60,
        getAttrs: (element) => {
          const img = element.querySelector('img[src]')
          if (!img)
            return false
          // 与父级 img 规则保持一致，宽高解析为数字
          const toNumber = (value: string | null) => (value ? Number.parseInt(value, 10) || null : null)
          return {
            'src': img.getAttribute('src'),
            'alt': img.getAttribute('alt'),
            'title': img.getAttribute('title'),
            'width': toNumber(img.getAttribute('width')),
            'height': toNumber(img.getAttribute('height')),
            'data-align': element.getAttribute('data-align') || img.getAttribute('data-align'),
          }
        },
      },
      ...(this.parent?.() ?? []),
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const img = ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)] as const
    const caption = node.attrs.caption as string | null
    if (!caption)
      return img
    return [
      'figure',
      { 'class': IMAGE_FIGURE_CLASS, 'data-align': node.attrs['data-align'] },
      img,
      ['figcaption', {}, caption],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView, {
      stopEvent: (props) => {
        // 注释输入框内的所有事件交给输入框处理，避免被编辑器当作节点选择/删除
        if ((props.event.target as Element | null)?.closest?.(`[${IMAGE_CAPTION_ATTR}]`))
          return true
        if (/dragstart|dragover|dragend|drop/.test(props.event.type))
          return false
        return !/mousedown|drag|drop/.test(props.event.type)
      },
    })
  },
})

export default Image
