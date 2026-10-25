import Code from '@tiptap/extension-code'

/**
 * 与行内代码互斥的标记：加粗、斜体、删除线、上下标、文字样式（颜色等）、高亮
 * 链接与注释不在此列，可以叠加在行内代码上
 */
const EXCLUDED_MARKS = ['bold', 'italic', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight']

/**
 * 行内代码
 *
 * Tiptap 默认的 code 标记用 `excludes: '_'` 排斥其他所有标记，于是：
 * - 已经加行内代码的词语再加链接、注释时，命令会被静默丢弃（按钮也一直禁用）
 * - 给带链接、注释的词语加行内代码时，链接和注释会被清掉
 * 这里显式列出互斥标记，只放开链接与注释，其余仍保持“代码内容原样”的语义
 */
export const InlineCode = Code.extend({
  excludes: EXCLUDED_MARKS.join(' '),
})
