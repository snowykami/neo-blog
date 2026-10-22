'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import copyToClipboard from '@/lib/clipboard'
import hljs from '@/lib/highlight'
import { languageMap } from '@/utils/common/post-render'
import 'highlight.js/styles/github-dark.css'

/**
 * HtmlEnhancer
 * - containerId: 传入渲染原始 HTML 的父容器 id（backend 存的原始 HTML 放在这个容器内）
 * 功能：
 * - 把 <pre><code class="language-..."> 包装成带工具栏和复制按钮的样式（与 markdown-codeblock 保持一致）
 * - 给外链添加 target/rel，并添加样式类
 * - 给 img/ul/ol/li/hr/inline code 添加样式类
 * - 使用 MutationObserver 处理后续动态注入的内容
 */

declare global {
  interface HTMLElement {
    __enhanced?: boolean
  }
  interface HTMLAnchorElement {
    __enhanced?: boolean
  }
  interface Element {
    __enhanced?: boolean
  }
}

export default function HtmlEnhancer({ containerId }: { containerId: string }) {
  const t = useTranslations('CodeBlock')
  useEffect(() => {
    hljs.highlightAll()
  }, [])
  useEffect(() => {
    const container = document.getElementById(containerId)
    if (!container)
      return

    const wrapCodeBlock = (pre: HTMLElement) => {
      if (pre.__enhanced)
        return
      const codeEl = pre.querySelector('code')
      if (!codeEl)
        return
      pre.__enhanced = true

      const langMatch = codeEl.className?.match?.(/language-([\w-]+)/)
      const lang = langMatch ? langMatch[1] : ''

      // 代码高亮固定使用 github-dark 主题，因此容器与工具栏在明暗模式下都保持深色（--code-bg）
      // not-prose：避免 typography 插件的 pre 样式覆盖这里的内边距与字号
      const wrapper = document.createElement('div')
      wrapper.className
        = 'not-prose relative my-6 rounded-xl overflow-hidden bg-(--code-bg) border border-white/10 group'

      const toolbar = document.createElement('div')
      toolbar.className
        = 'flex items-center justify-between h-9 px-4 border-b border-white/10 bg-white/5'

      const langSpan = document.createElement('span')
      langSpan.className = 'text-xs text-white/60 font-mono'
      langSpan.textContent = lang ? (languageMap[lang.toLowerCase()] || lang) : ''
      toolbar.appendChild(langSpan)

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className
        = 'px-2 py-1 rounded-md text-xs text-white/70 hover:text-white hover:bg-white/10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity'
      btn.textContent = t('copy')
      toolbar.appendChild(btn)

      // move pre into wrapper
      const parent = pre.parentNode
      if (!parent)
        return
      parent.replaceChild(wrapper, pre)
      wrapper.appendChild(toolbar)
      wrapper.appendChild(pre)

      // 内边距放在 pre 上，code 上 hljs 自带的 padding / 背景去掉，保证横向滚动时内边距一致
      pre.classList.add(
        'overflow-x-auto',
        'bg-transparent',
        'px-4',
        'py-3',
        'm-0',
        'text-[0.875rem]',
        'leading-6',
        'text-gray-100',
        'font-mono',
      )
      pre.style.margin = '0'
      codeEl.classList.add('!p-0', '!bg-transparent')

      // copy handler
      const onClick = async () => {
        try {
          const text = pre.textContent
          const ok = await copyToClipboard(text)
          if (ok) {
            toast.success(t('copy_success'))
            btn.textContent = t('copied')
            setTimeout(() => (btn.textContent = t('copy')), 1200)
          }
          else {
            toast.error(t('copy_failed'))
            btn.textContent = t('failed')
            setTimeout(() => (btn.textContent = t('copy')), 1200)
          }
        }
        catch (e) {
          console.error(e)
          toast.error(t('copy_failed'))
          btn.textContent = t('failed')
          setTimeout(() => (btn.textContent = t('copy')), 1200)
        }
      }
      btn.addEventListener('click', onClick)

      // cleanup if wrapper removed later
      const mo = new MutationObserver(() => {
        if (!document.body.contains(btn)) {
          btn.removeEventListener('click', onClick)
          mo.disconnect()
        }
      })
      mo.observe(document.body, { childList: true, subtree: true })
    }

    // initial: only handle pre > code
    container.querySelectorAll('pre').forEach((p) => {
      if (p.querySelector('code'))
        wrapCodeBlock(p as HTMLElement)
    })

    // observe only for newly added <pre> elements
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList')
          continue
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement))
            return
          if (node.tagName.toLowerCase() === 'pre') {
            if (node.querySelector('code'))
              wrapCodeBlock(node as HTMLElement)
          }
          else {
            // maybe a fragment; look for pre inside
            node.querySelectorAll?.('pre').forEach((p) => {
              if (p.querySelector('code'))
                wrapCodeBlock(p as HTMLElement)
            })
          }
        })
      }
    })

    observer.observe(container, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [containerId])

  return null
}
