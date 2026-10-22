import { Extension } from '@tiptap/react'
import { downloadSelectedImage } from '@/components/tiptap-ui/image-download-button/use-image-download'
import { insertImage } from '@/components/tiptap-ui/image-upload-button/use-image-upload'

export interface EditorShortcutsOptions {
  onOpenLink?: () => void
  onOpenAnnotation?: () => void
  onOpenAI?: () => void
}

/**
 * 编辑器级快捷键（标记、标题、列表等快捷键由各扩展自带）
 * - Mod-k：编辑链接；Mod-Alt-m：编辑注释（弹层由外部 UI 打开）
 * - Mod-\：清除格式
 * - Mod-Shift-i：插入图片上传块；Mod-Shift-d：下载选中的图片
 * - Mod-j：AI 写作（有文字选区时润色，否则在光标处帮写）
 */
export const EditorShortcuts = Extension.create<EditorShortcutsOptions>({
  name: 'editorShortcuts',

  addOptions() {
    return {
      onOpenLink: undefined,
      onOpenAnnotation: undefined,
      onOpenAI: undefined,
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (!this.editor.isEditable || !this.options.onOpenLink)
          return false
        this.options.onOpenLink()
        return true
      },
      'Mod-Alt-m': () => {
        if (!this.editor.isEditable || !this.options.onOpenAnnotation)
          return false
        this.options.onOpenAnnotation()
        return true
      },
      'Mod-j': () => {
        if (!this.editor.isEditable || !this.options.onOpenAI)
          return false
        this.options.onOpenAI()
        return true
      },
      'Mod-\\': () => this.editor.chain().focus().unsetAllMarks().clearNodes().run(),
      'Mod-Shift-i': () => insertImage(this.editor),
      'Mod-Shift-d': () => {
        if (!this.editor.isActive('image'))
          return false
        void downloadSelectedImage(this.editor)
        return true
      },
    }
  },
})
