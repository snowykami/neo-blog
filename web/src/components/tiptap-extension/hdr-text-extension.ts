import { Mark, mergeAttributes } from '@tiptap/react'

/**
 * HDR 文字：框选文字后标记为 HDR，正文保存为 <span data-hdr>，可与文字颜色叠加（按字当前的颜色发光）。
 * 前台在 HDR 屏幕上（且读者开着 HDR 高光）让这些字亮过 SDR 白，见 components/blog-post/content-hdr-text.tsx；
 * 编辑器里只用淡淡的辉光提示「这里是 HDR 文字」（见 editor-content.scss），不做真正的 HDR
 */
export const HdrText = Mark.create({
  name: 'hdr',

  parseHTML() {
    return [{ tag: 'span[data-hdr]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-hdr': '' }), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-h': () => this.editor.commands.toggleMark(this.name),
    }
  },
})
