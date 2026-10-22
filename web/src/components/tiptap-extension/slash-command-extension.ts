import type { Editor, Range } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import type { LucideIcon } from 'lucide-react'
import type { SlashMenuHandle, SlashMenuProps } from '@/components/tiptap-ui/slash-menu/slash-menu'
import { PluginKey } from '@tiptap/pm/state'
import { Extension, ReactRenderer } from '@tiptap/react'
import { Suggestion } from '@tiptap/suggestion'
import { SlashMenu } from '@/components/tiptap-ui/slash-menu/slash-menu'

export interface SlashCommandItem {
  id: string
  group: string
  title: string
  hint: string
  icon: LucideIcon
  // 中文 / 拼音 / 英文别名，用于过滤
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

export interface SlashCommandOptions {
  getItems: (query: string) => SlashCommandItem[]
}

export const slashCommandPluginKey = new PluginKey('slashCommand')

/**
 * 斜杠命令：行首或空格后输入 “/” 唤出命令面板，基于 @tiptap/suggestion
 * 面板为 React 组件（SlashMenu），由 suggestion 插件挂载并跟随光标定位
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      getItems: () => [],
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        // 行首或空格（含全角空格）后触发，避免在网址等文本中误触发
        allowedPrefixes: [' ', ' ', '　'],
        // 代码块内不触发
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => this.options.getItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createSlashMenuRenderer,
      }),
    ]
  },
})

function createSlashMenuRenderer() {
  let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null
  let unmount: (() => void) | null = null

  const toMenuProps = (props: SuggestionProps<SlashCommandItem, SlashCommandItem>): SlashMenuProps => ({
    items: props.items,
    query: props.query,
    onSelect: item => props.command(item),
  })

  return {
    onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
      renderer = new ReactRenderer(SlashMenu, { props: toMenuProps(props), editor: props.editor })
      const element = renderer.element as HTMLElement
      element.style.zIndex = '60'
      // 由 suggestion 插件负责挂载与跟随光标定位
      unmount = props.mount(element)
    },

    onUpdate: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
      renderer?.updateProps(toMenuProps(props))
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape')
        return true
      return renderer?.ref?.onKeyDown(props.event) ?? false
    },

    onExit: () => {
      unmount?.()
      unmount = null
      renderer?.destroy()
      renderer = null
    },
  }
}
