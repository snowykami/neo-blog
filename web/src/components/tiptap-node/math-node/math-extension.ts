import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Extension, InputRule } from '@tiptap/react'
import { BLOCK_MATH_TYPE, findMath, findMathAtEnd, INLINE_MATH_TYPE, isInOpenMath, KATEX_OPTIONS, matchBlockMath } from '@/lib/math/latex'

export const INLINE_MATH_NODE = 'inlineMath'
export const BLOCK_MATH_NODE = 'blockMath'

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    mathEditing: {
      // 插入公式并打开编辑弹层；行内公式在有文字选区时以选中的文字为公式内容
      insertMath: (options: { display: boolean }) => ReturnType
      // 打开光标处（选中的）公式的编辑弹层
      editMath: () => ReturnType
    }
  }
}

export function isMathNode(node: PMNode | null | undefined): node is PMNode {
  return node?.type.name === INLINE_MATH_NODE || node?.type.name === BLOCK_MATH_NODE
}

/** 复制自其他页面的公式：KaTeX 的 annotation 或 MathML 的 alttext 中保存着 TeX 源码 */
function texOf(element: HTMLElement): string | null {
  const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? element.getAttribute('alttext')
  return tex?.trim() || null
}

function pastedMathAttrs(element: HTMLElement) {
  const latex = texOf(element)
  return latex ? { latex } : false
}

/**
 * 公式节点：沿用 @tiptap/extension-mathematics 的存储格式、命令与 KaTeX 节点视图
 * - 输入规则改为 $…$ / $$…$$（见 MathEditing），官方的 $$…$$ / $$$…$$$ 不启用
 * - 额外识别粘贴进来的 KaTeX / MathML 公式（含本站前台渲染后的公式）
 */
const MathInlineNode = InlineMath.extend({
  addInputRules: () => [],
  parseHTML() {
    return [
      { tag: `span[data-type="${INLINE_MATH_TYPE}"]` },
      { tag: 'span.katex', getAttrs: node => pastedMathAttrs(node as HTMLElement) },
      { tag: 'math', getAttrs: node => pastedMathAttrs(node as HTMLElement) },
    ]
  },
})

const MathBlockNode = BlockMath.extend({
  addInputRules: () => [],
  parseHTML() {
    return [
      { tag: `div[data-type="${BLOCK_MATH_TYPE}"]` },
      // 先于行内公式的规则匹配
      { tag: 'span.katex-display', priority: 60, getAttrs: node => pastedMathAttrs(node as HTMLElement) },
      { tag: 'math[display="block"]', priority: 60, getAttrs: node => pastedMathAttrs(node as HTMLElement) },
    ]
  },
})

/** 把 paragraphPos 处的段落替换为公式块；不能放公式块的位置（如列表项的第一段）返回 false */
function replaceParagraphWithBlock(tr: Transaction, paragraphPos: number, latex: string) {
  const $pos = tr.doc.resolve(paragraphPos)
  const index = $pos.index()
  const type = tr.doc.type.schema.nodes[BLOCK_MATH_NODE]
  const paragraph = $pos.nodeAfter
  if (!paragraph || !$pos.parent.canReplaceWith(index, index + 1, type))
    return false
  tr.replaceWith(paragraphPos, paragraphPos + paragraph.nodeSize, type.create({ latex }))
  return true
}

/**
 * 粘贴的内容中：文字里的 $…$ 转为行内公式，整段 $$…$$ 与 $$ 包起来的多段转为公式块；代码中的不转换
 * allowBlock 为 false 时只转换行内公式（所在容器放不下公式块时）
 */
function convertPastedMath(fragment: Fragment, schema: Schema, allowBlock = true): Fragment {
  const inlineType = schema.nodes[INLINE_MATH_NODE]
  const blockType = schema.nodes[BLOCK_MATH_NODE]
  const nodes: PMNode[] = []
  const children: PMNode[] = []
  fragment.forEach(child => children.push(child))

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (allowBlock && child.type.name === 'paragraph' && child.childCount > 0 && child.content.content.every(node => node.isText)) {
      const text = child.textContent
      // 多段：单独一行的 $$ … $$
      if (text.trim() === '$$') {
        const end = children.findIndex((node, j) => j > i && node.type.name === 'paragraph' && node.textContent.trim() === '$$')
        if (end > i + 1) {
          const latex = children.slice(i + 1, end).map(node => node.textContent).join('\n').trim()
          if (latex) {
            nodes.push(blockType.create({ latex }))
            i = end
            continue
          }
        }
      }
      const latex = matchBlockMath(text)
      if (latex) {
        nodes.push(blockType.create({ latex }))
        continue
      }
    }
    if (child.isTextblock && !child.type.spec.code) {
      const inline: PMNode[] = []
      child.forEach((node) => {
        if (!node.isText || node.marks.some(mark => mark.type.spec.code)) {
          inline.push(node)
          return
        }
        const text = node.text!
        let last = 0
        for (const match of findMath(text)) {
          if (match.from > last)
            inline.push(node.cut(last, match.from))
          inline.push(inlineType.create({ latex: match.latex }, null, node.marks))
          last = match.to
        }
        inline.push(last === 0 ? node : node.cut(last))
      })
      nodes.push(child.copy(Fragment.fromArray(inline.filter(node => !node.isText || node.text))))
      continue
    }
    if (child.isLeaf || child.type.spec.code) {
      nodes.push(child)
      continue
    }
    const content = convertPastedMath(child.content, schema)
    nodes.push(child.copy(child.type.validContent(content) ? content : convertPastedMath(child.content, schema, false)))
  }
  return Fragment.fromArray(nodes)
}

export interface MathEditingOptions {
  // 打开公式编辑弹层；pos 为公式节点的位置
  onEdit?: (pos: number) => void
}

/**
 * 公式的输入与编辑
 * - 输入结尾的 $ 时：整段为 $$…$$ 的段落转为公式块，其余 $…$ / $$…$$ 转为行内公式（Backspace 可撤销转换）
 * - 段落中只有 $$ 时按 Enter：转为空的公式块并打开编辑
 * - 选中公式时按 Enter、或点击公式：打开编辑；Mod-Shift-m：插入行内公式（有选区时转换选中的文字）
 * - 粘贴：文字中的 $…$ / $$…$$ 转为公式
 */
export const MathEditing = Extension.create<MathEditingOptions>({
  name: 'mathEditing',
  // Enter 等快捷键先于段落拆分处理
  priority: 110,

  addOptions() {
    return { onEdit: undefined }
  },

  addCommands() {
    const openEditor = (pos: number) => {
      // 等节点视图挂载后再定位弹层
      window.requestAnimationFrame(() => this.options.onEdit?.(pos))
    }
    return {
      insertMath: ({ display }) => ({ state, tr, dispatch }) => {
        const { selection } = state
        const $from = selection.$from
        let pos: number
        if (display) {
          const node = state.schema.nodes[BLOCK_MATH_NODE].create({ latex: '' })
          if (selection.empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
            // 空段落（如输入斜杠命令后）直接换成公式块
            pos = $from.before()
            tr.replaceWith(pos, $from.after(), node)
          }
          else {
            pos = selection instanceof NodeSelection ? selection.to : $from.depth > 0 ? $from.after() : $from.pos
            const $pos = state.doc.resolve(pos)
            if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), node.type))
              return false
            tr.insert(pos, node)
          }
        }
        else {
          if (!$from.parent.inlineContent || $from.parent.type.spec.code)
            return false
          const latex = selection.empty || !$from.sameParent(selection.$to) ? '' : state.doc.textBetween(selection.from, selection.to, ' ').trim()
          pos = selection.from
          tr.replaceWith(selection.from, selection.empty ? selection.from : selection.to, state.schema.nodes[INLINE_MATH_NODE].create({ latex }))
        }
        if (dispatch) {
          tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView()
          openEditor(pos)
        }
        return true
      },
      editMath: () => ({ state }) => {
        const { selection } = state
        if (!(selection instanceof NodeSelection) || !isMathNode(selection.node) || !this.editor.isEditable)
          return false
        openEditor(selection.from)
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        if (editor.commands.editMath())
          return true
        const { selection } = editor.state
        const { $from } = selection
        if (!selection.empty || $from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '$$' || $from.parentOffset !== 2)
          return false
        const pos = $from.before()
        const { tr } = editor.state
        if (!replaceParagraphWithBlock(tr, pos, ''))
          return false
        editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
        window.requestAnimationFrame(() => this.options.onEdit?.(pos))
        return true
      },
      'Mod-Shift-m': ({ editor }) => editor.commands.insertMath({ display: false }),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: (text) => {
          const match = findMathAtEnd(text)
          return match ? { index: match.from, text: text.slice(match.from), data: { latex: match.latex } } : null
        },
        handler: ({ state, range, match }) => {
          const latex = match.data?.latex
          if (typeof latex !== 'string')
            return null
          const { tr } = state
          const $from = tr.doc.resolve(range.from)
          // 整段就是 $$…$$：换成公式块
          if (match[0].startsWith('$$') && $from.parentOffset === 0 && range.to === $from.end() && $from.parent.type.name === 'paragraph'
            && replaceParagraphWithBlock(tr, $from.before(), latex)) {
            return
          }
          tr.replaceWith(range.from, range.to, state.schema.nodes[INLINE_MATH_NODE].create({ latex }))
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mathPaste'),
        props: {
          transformPasted: (slice) => {
            const content = convertPastedMath(slice.content, this.editor.schema)
            return content.eq(slice.content) ? slice : new Slice(content, slice.openStart, slice.openEnd)
          },
        },
      }),
    ]
  },
})

/**
 * 包装其他扩展的输入规则：正在输入的公式（$ 已开头、尚未闭合）中不触发，
 * 避免排版替换把 LaTeX 改坏（^2 → ²、1/2 → ½、-> → → 等）
 */
export function skipInOpenMath(rules: InputRule[]): InputRule[] {
  return rules.map(rule => new InputRule({
    find: rule.find,
    undoable: rule.undoable,
    handler: (props) => {
      const $from = props.state.doc.resolve(props.range.from)
      if ($from.parent.isTextblock && isInOpenMath($from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')))
        return null
      return rule.handler(props)
    },
  }))
}

/** 编辑器使用的公式扩展；onEdit 打开编辑弹层 */
export function createMathExtensions(onEdit?: (pos: number) => void) {
  const onClick = onEdit ? (_node: PMNode, pos: number) => onEdit(pos) : undefined
  return [
    MathInlineNode.configure({ katexOptions: KATEX_OPTIONS, onClick }),
    MathBlockNode.configure({ katexOptions: { ...KATEX_OPTIONS, displayMode: true }, onClick }),
    MathEditing.configure({ onEdit }),
  ]
}
