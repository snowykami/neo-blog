'use client'

import hljs from 'highlight.js'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import copyToClipboard from '@/lib/clipboard'
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

      // build wrapper similar to markdown-codeblock, minimal DOM ops
      const wrapper = document.createElement('div')
      wrapper.className
        = 'relative my-0 !mx-0 rounded-xl overflow-hidden bg-[#f5f5f7] dark:bg-[#23272f] border border-gray-200 dark:border-gray-700 shadow-sm group'

      const toolbar = document.createElement('div')
      toolbar.className
        = 'flex items-center h-8 px-3 bg-[#e5e7eb] dark:bg-[#23272f] border-b border-gray-200 dark:border-gray-700 relative'

      const leftDots = document.createElement('div')
      leftDots.className = 'flex items-center'
      const dot = (color: string) => {
        const d = document.createElement('span')
        d.className = `w-3.5 h-3.5 rounded-full ${color} mr-2`
        return d
      }
      leftDots.appendChild(dot('bg-red-400'))
      leftDots.appendChild(dot('bg-yellow-400'))
      leftDots.appendChild(dot('bg-green-400'))
      toolbar.appendChild(leftDots)

      if (lang) {
        const langSpan = document.createElement('span')
        langSpan.className
          = 'absolute left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-gray-400 font-mono'
        langSpan.textContent = languageMap[lang.toLowerCase()] || lang
        toolbar.appendChild(langSpan)
      }

      const rightBox = document.createElement('div')
      rightBox.className
        = 'absolute right-3 top-1/2 -translate-y-1/2 flex space-x-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity'
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className
        = 'px-2 py-1 rounded text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600'
      btn.textContent = t('copy')
      rightBox.appendChild(btn)
      toolbar.appendChild(rightBox)

      // move pre into wrapper
      const parent = pre.parentNode
      if (!parent)
        return
      parent.replaceChild(wrapper, pre)
      wrapper.appendChild(toolbar)
      wrapper.appendChild(pre)

      // style pre similar to markdown-codeblock
      pre.classList.add(
        'overflow-x-auto',
        'bg-transparent',
        'text-sm',
        '!p-0',
        'md:p-8',
        'm-0',
        'rounded-t-none',
        'text-gray-800',
        'dark:text-gray-100',
      )
      pre.style.margin = '0'

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
