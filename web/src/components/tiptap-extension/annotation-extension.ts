import { Extension, Mark } from '@tiptap/react'
import { ANNOTATION_ATTR, ANNOTATION_MARK, AUTO_MATCH_ATTR } from './annotation-constants'

const autoMatchAttribute = {
  default: false,
  parseHTML: (element: HTMLElement) => element.getAttribute(AUTO_MATCH_ATTR) === 'true',
  renderHTML: (attributes: Record<string, unknown>) => (attributes.autoMatch ? { [AUTO_MATCH_ATTR]: 'true' } : {}),
}

export const Annotation = Mark.create({
  name: ANNOTATION_MARK,
  // 在注释词语末尾继续输入时不延续注释
  inclusive: false,

  addAttributes() {
    return {
      note: {
        default: '',
        parseHTML: element => element.getAttribute(ANNOTATION_ATTR) ?? '',
        renderHTML: attributes => ({ [ANNOTATION_ATTR]: attributes.note }),
      },
      autoMatch: autoMatchAttribute,
    }
  },

  parseHTML() {
    return [{ tag: `span[${ANNOTATION_ATTR}]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },
})

// 给 StarterKit 自带的链接加上自动匹配属性
export const LinkAutoMatch = Extension.create({
  name: 'linkAutoMatch',

  addGlobalAttributes() {
    return [{ types: ['link'], attributes: { autoMatch: autoMatchAttribute } }]
  },
})
