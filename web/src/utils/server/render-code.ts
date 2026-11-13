import * as cheerio from 'cheerio'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import hljs from '@/lib/highlight'
import { CODE_BLOCK_ATTR, CODE_COPY_ATTR } from '@/utils/common/code-block'
import { languageMap } from '@/utils/common/post-render'

/**
 * 代码块的服务端渲染：包上带语言名与复制按钮的工具栏，并用 highlight.js 着色（与浏览器端原来的做法一致，见
 * components/blog-post/blog-content-enhanced.tsx）。之前这些都在水合后才做：首屏先出没有工具栏、没有颜色的 \<pre\>，
 * 水合后每个代码块突然高出一条工具栏，把下面的正文往下推（布局偏移），还要再下载 highlight.js。
 * 结果随正文按内容哈希缓存（见 render-content.ts），复制按钮的点击由浏览器端按事件委托处理
 */

// 与浏览器端的包装保持一致（blog-content-enhanced.tsx 的 wrapCodeBlock）
const WRAPPER_CLASS = 'not-prose relative my-6 rounded-xl overflow-hidden bg-(--code-bg) border border-white/10 group'
const TOOLBAR_CLASS = 'flex items-center justify-between h-9 px-4 border-b border-white/10 bg-white/5'
const LANG_CLASS = 'text-xs text-white/60 font-mono'
const COPY_CLASS = 'px-2 py-1 rounded-md text-xs text-white/70 hover:text-white hover:bg-white/10 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 max-sm:h-9 max-sm:px-3 max-sm:-mr-2'
const PRE_CLASSES = ['overflow-x-auto', 'bg-transparent', 'px-4', 'py-3', 'm-0', 'text-[0.875rem]', 'leading-6', 'text-gray-100', 'font-mono']
const CODE_CLASSES = ['!p-0', '!bg-transparent']
const NO_HIGHLIGHT = new Set(['no-highlight', 'nohighlight', 'plaintext', 'text', 'txt', 'plain'])

function highlight(text: string, lang: string): string | null {
  const key = lang.toLowerCase()
  if (NO_HIGHLIGHT.has(key))
    return null
  try {
    if (!key)
      return hljs.highlightAuto(text).value
    // 没注册的语言不着色（与浏览器端 highlightElement 遇到未知语言时一致）
    return hljs.getLanguage(key) ? hljs.highlight(text, { language: key, ignoreIllegals: true }).value : null
  }
  catch {
    return null
  }
}

/** 包装并着色正文里的代码块；copyLabel 为复制按钮的文字（随页面语言） */
export function renderCodeBlocks(html: string, copyLabel: string): string {
  if (!html || !html.includes('<pre'))
    return html
  const $ = cheerio.load(html, null, false)
  let changed = false
  $('pre').each((_, el) => {
    const pre = $(el)
    // 组件岛内的代码块由组件自己渲染
    if (pre.closest(COMPONENT_ROOT_SELECTOR).length > 0 || pre.parent().is(`[${CODE_BLOCK_ATTR}]`))
      return
    const code = pre.children('code').first()
    if (code.length === 0)
      return
    const lang = (code.attr('class') ?? '').match(/(?:^|\s)lang(?:uage)?-([\w-]+)/)?.[1] ?? ''
    const highlighted = highlight(code.text(), lang)
    if (highlighted != null) {
      code.html(highlighted)
      code.addClass('hljs')
      // 浏览器端的 highlight.js 据此跳过已着色的代码块
      code.attr('data-highlighted', 'yes')
    }
    code.addClass(CODE_CLASSES.join(' '))
    pre.addClass(PRE_CLASSES.join(' '))
    pre.attr('style', 'margin:0')

    const wrapper = $('<div></div>').attr('class', WRAPPER_CLASS).attr(CODE_BLOCK_ATTR, '')
    const toolbar = $('<div></div>').attr('class', TOOLBAR_CLASS)
    toolbar.append($('<span></span>').attr('class', LANG_CLASS).text(lang ? (languageMap[lang.toLowerCase()] || lang) : ''))
    toolbar.append($('<button></button>').attr('type', 'button').attr('class', COPY_CLASS).attr(CODE_COPY_ATTR, '').text(copyLabel))
    pre.before(wrapper)
    wrapper.append(toolbar)
    wrapper.append(pre)
    changed = true
  })
  return changed ? $.html() : html
}
