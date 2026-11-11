import type { Editor } from '@tiptap/react'
import type { ComponentType } from 'react'
import type { Root } from 'react-dom/client'
import { Editor as EditorClass, EditorContent } from '@tiptap/react'
import { NextIntlClientProvider } from 'next-intl'
import { createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { getContentComponent } from '@/components/content-components/registry'
import { createContentExtensions } from '@/lib/tiptap-extensions'
import { getLocaleMessages } from '@/locales'

let editor: Editor | null = null
let root: Root | null = null
let container: HTMLElement | null = null
let restore: (() => void) | null = null

// 等 React 渲染与微任务完成
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  root?.unmount()
  container?.remove()
  editor?.destroy()
  restore?.()
  root = null
  container = null
  editor = null
  restore = null
})

/** 把注册表里某个组件的本体换成可控的懒加载组件（模拟 next/dynamic 的代码还没下载完） */
function stubLazyComponent(name: string) {
  const def = getContentComponent(name)!
  const original = def.component
  let resolved = false
  let resolve!: (mod: { default: ComponentType<Record<string, unknown>> }) => void
  def.component = lazy(() => new Promise<{ default: ComponentType<Record<string, unknown>> }>((r) => {
    resolve = r
  }))
  restore = () => {
    def.component = original
  }
  return () => {
    if (resolved)
      return
    resolved = true
    resolve({ default: () => createElement('p', { 'data-stub-loaded': '' }, 'loaded') })
  }
}

describe('组件块节点视图', () => {
  it('组件代码加载中时就地显示占位，不让外层（路由 loading）边界挂起', async () => {
    const finishLoading = stubLazyComponent('githubRepo')
    editor = new EditorClass({
      extensions: createContentExtensions({ upload: async () => '', placeholder: () => '', getSlashItems: () => [] }),
      content: '<p>before</p><div data-component="githubRepo" data-props=\'{"repo":"snowykami/neo-blog"}\' data-version="1"></div><p>after</p>',
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // 外层 Suspense 相当于路由的 loading 边界：它一旦显示 fallback，编辑页整个被隐藏，EditorContent 会卸载节点视图。
    // 修复前这里会陷入只靠微任务推进的「隐藏 → 恢复 → 重建节点视图 → 再挂起」循环，定时器永远轮不到、测试会卡死；
    // 所以外层 fallback 渲染时顺手让组件加载完成，打断循环，测试以断言失败结束而不是卡住
    let pageFallbackRenders = 0
    function PageFallback() {
      pageFallbackRenders++
      finishLoading()
      return createElement('div', { 'data-page-fallback': '' })
    }
    root.render(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: getLocaleMessages('en'),
        children: createElement(Suspense, {
          fallback: createElement(PageFallback),
          children: createElement(EditorContent, { editor }),
        }),
      }),
    )
    for (let i = 0; i < 5; i++)
      await flush()

    expect(pageFallbackRenders).toBe(0)
    const block = container.querySelector('.neo-component-block')
    expect(block).toBeTruthy()
    expect(block!.querySelector('[data-slot="skeleton"]')).toBeTruthy()
    expect(container.textContent).toContain('before')

    // React 揭示 Suspense 内容有约 300ms 的节流，这里轮询等待
    finishLoading()
    for (let i = 0; i < 100 && !container.querySelector('[data-stub-loaded]'); i++)
      await new Promise(resolve => setTimeout(resolve, 20))
    expect(pageFallbackRenders).toBe(0)
    expect(container.querySelector('.neo-component-block [data-stub-loaded]')).toBeTruthy()
  })
})
