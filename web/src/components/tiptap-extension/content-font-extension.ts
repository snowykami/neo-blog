import type { ContentFont as ContentFontKey } from '@/lib/content-theme'
import { Mark } from '@tiptap/react'
import { CONTENT_FONT_ATTR, isContentFont } from '@/lib/content-theme'

export const CONTENT_FONT_MARK = 'contentFont'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    contentFont: {
      // 给选中的文字指定字体
      setContentFont: (font: ContentFontKey) => ReturnType
      // 恢复为正文默认字体
      unsetContentFont: () => ReturnType
    }
  }
}

function fontOf(element: HTMLElement) {
  const font = element.getAttribute(CONTENT_FONT_ATTR)
  return isContentFont(font) ? font : null
}

/**
 * 局部字体：正文里个别词句换用另一种字体，保存为 <span data-font="kai">…</span>。
 * 只保存字体键，不保存字体名：字体栈与网页字体由前台按字体键决定（见 lib/content-theme.ts），
 * RSS 阅读器、AI 摘要等其他输出不认识这个属性，自然降级为默认字体
 */
export const ContentFont = Mark.create({
  name: CONTENT_FONT_MARK,

  addAttributes() {
    return {
      font: {
        default: null,
        parseHTML: fontOf,
        renderHTML: attributes => (attributes.font ? { [CONTENT_FONT_ATTR]: attributes.font } : {}),
      },
    }
  },

  parseHTML() {
    // 只认识注册表里的字体键
    return [{ tag: `span[${CONTENT_FONT_ATTR}]`, getAttrs: element => (fontOf(element) ? null : false) }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },

  addCommands() {
    return {
      setContentFont: font => ({ commands }) => commands.setMark(this.name, { font }),
      unsetContentFont: () => ({ commands }) => commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    }
  },
})
