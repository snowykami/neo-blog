import type { MarkedExtension, Tokens } from 'marked'
import { BLOCK_MATH_TYPE, INLINE_MATH_TYPE, matchMathAt } from './latex'

function escapeAttr(text: string) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 单独成段的 $$ … $$（可跨行），结尾的 $$ 之后到行尾只能是空白
const BLOCK_MATH = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/

/**
 * marked 扩展：把 Markdown 中的公式输出为编辑器的公式节点
 * - 单独成段的 $$…$$ 为公式块；段落中的 $…$、$$…$$ 为行内公式（规则见 matchMathAt）
 * - 用于 AI 写作：模型输出的 Markdown 转为编辑器内容
 */
export function markedMath(): MarkedExtension {
  return {
    extensions: [
      {
        name: 'blockMath',
        level: 'block',
        start: src => src.match(/^ {0,3}\$\$/m)?.index,
        tokenizer(src) {
          const match = BLOCK_MATH.exec(src)
          if (!match || !match[1].trim())
            return undefined
          return { type: 'blockMath', raw: match[0], latex: match[1].trim() }
        },
        renderer: token => `<div data-type="${BLOCK_MATH_TYPE}" data-latex="${escapeAttr((token as Tokens.Generic).latex)}"></div>\n`,
      },
      {
        name: 'inlineMath',
        level: 'inline',
        start: (src) => {
          const index = src.indexOf('$')
          return index < 0 ? undefined : index
        },
        tokenizer(src) {
          const match = matchMathAt(src, 0)
          if (!match)
            return undefined
          return { type: 'inlineMath', raw: src.slice(0, match.to), latex: match.latex.trim() }
        },
        renderer: token => `<span data-type="${INLINE_MATH_TYPE}" data-latex="${escapeAttr((token as Tokens.Generic).latex)}"></span>`,
      },
    ],
  }
}
