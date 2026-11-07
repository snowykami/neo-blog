import { Mark, mergeAttributes } from '@tiptap/react'
import { HDR_BRIGHTNESS, HDR_TEXT_DEFAULT_LEVEL, hdrTextLevel } from '@/lib/hdr-color'

/** 编辑器里各档位的预览色点（由浅黄到红，越暖越亮），与 editor-content.scss 中 [data-hdr] 的色点一致 */
export const HDR_TEXT_LEVEL_COLORS = ['#fde68a', '#facc15', '#f59e0b', '#f97316', '#ef4444'] as const

/** 档位数（1 ~ HDR_TEXT_LEVEL_COUNT），倍数见 HDR_BRIGHTNESS.contentText */
export const HDR_TEXT_LEVEL_COUNT = HDR_BRIGHTNESS.contentText.length

/**
 * HDR 文字：框选文字后标记为 HDR 并选择亮度档位，正文保存为 <span data-hdr="档位">，可与文字颜色叠加（按字当前的颜色发光）。
 * 只存档位不存倍数：调亮度只改 HDR_BRIGHTNESS.contentText，已有文章跟着变；旧内容的 data-hdr="" 视为默认档位。
 * 前台在 HDR 屏幕上（且读者开着 HDR 高光）让这些字亮过 SDR 白，见 components/blog-post/content-hdr-text.tsx；
 * 编辑器里只用淡淡的辉光与档位色点提示（见 editor-content.scss），不做真正的 HDR
 */
export const HdrText = Mark.create({
  name: 'hdr',

  addAttributes() {
    return {
      level: {
        default: HDR_TEXT_DEFAULT_LEVEL,
        parseHTML: element => hdrTextLevel(element.getAttribute('data-hdr')),
        renderHTML: attributes => ({ 'data-hdr': String(attributes.level) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-hdr]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-h': () => this.editor.commands.toggleMark(this.name),
    }
  },
})
