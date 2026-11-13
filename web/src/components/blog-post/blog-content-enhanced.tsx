'use client'

import { CopyCheckIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { COMPONENT_ROOT_SELECTOR } from '@/components/content-components/constants'
import { notifySuccess } from '@/components/layout/topbar-island/island-feedback'
import copyToClipboard from '@/lib/clipboard'
import { getVisibleElementById } from '@/utils/client/dom'
import { languageMap } from '@/utils/common/post-render'
import 'highlight.js/styles/github-dark.css'

/**
 * HtmlEnhancer
 * - containerId: 传入渲染原始 HTML 的父容器 id（backend 存的原始 HTML 放在这个容器内）
 * 功能：
 * - 把 <pre><code class="language-..."> 包装成带工具栏和复制按钮的样式（与 markdown-codeblock 保持一致），并按需懒加载 highlight.js
 * - 使用容器级 MutationObserver 处理后续动态注入的代码块，卸载时统一回收事件与定时器
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
    const container = getVisibleElementById(containerId)
    if (!container)
      return

    let disposed = false
    const cleanups: Array<() => void> = []
    const timers = new Set<number>()
    let hljsPromise: Promise<typeof import('@/lib/highlight')['default']> | null = null

    const highlightCodeElement = (codeEl: HTMLElement) => {
      if (codeEl.dataset.highlighted === 'yes')
        return
      hljsPromise ??= import('@/lib/highlight').then(m => m.default)
      void hljsPromise.then((hljs) => {
        if (disposed || !codeEl.isConnected || codeEl.dataset.highlighted === 'yes')
          return
        hljs.highlightElement(codeEl)
      })
    }

    const wrapCodeBlock = (pre: HTMLElement) => {
      // 组件岛内的代码块由组件自己渲染（React 管理的 DOM 不能被改动）
      if (pre.__enhanced || pre.closest(COMPONENT_ROOT_SELECTOR))
        return
      const codeEl = pre.querySelector('code')
      if (!codeEl)
        return
      pre.__enhanced = true
      highlightCodeElement(codeEl)

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
      // 能悬停的设备（鼠标）悬停代码块时才显示；触屏手机、平板不能悬停，始终显示，手机上加大到 36px 高
      btn.className
        = 'px-2 py-1 rounded-md text-xs text-white/70 hover:text-white hover:bg-white/10 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 max-sm:h-9 max-sm:px-3 max-sm:-mr-2'
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

      const resetLabelLater = () => {
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          if (!disposed)
            btn.textContent = t('copy')
        }, 1200)
        timers.add(timer)
      }

      // copy handler
      const onClick = async () => {
        try {
          const text = pre.textContent
          const ok = await copyToClipboard(text)
          if (ok) {
            notifySuccess(t('copy_success'), { key: 'copy', icon: <CopyCheckIcon aria-hidden className="text-emerald-400" />, countable: true })
            btn.textContent = t('copied')
            resetLabelLater()
          }
          else {
            toast.error(t('copy_failed'))
            btn.textContent = t('failed')
            resetLabelLater()
          }
        }
        catch (e) {
          console.error(e)
          toast.error(t('copy_failed'))
          btn.textContent = t('failed')
          resetLabelLater()
        }
      }
      btn.addEventListener('click', onClick)
      cleanups.push(() => btn.removeEventListener('click', onClick))
    }

    // initial: only handle pre > code
    container.querySelectorAll('pre').forEach((p) => {
      if (p.querySelector('code'))
        wrapCodeBlock(p as HTMLElement)
    })

    // observe only for newly added <pre> elements inside container
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

    return () => {
      disposed = true
      observer.disconnect()
      timers.forEach(timer => window.clearTimeout(timer))
      timers.clear()
      cleanups.forEach(fn => fn())
    }
  }, [containerId, t])

  return null
}
