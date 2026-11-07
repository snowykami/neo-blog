import type { Root } from 'react-dom/client'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useCompositionInput } from './use-composition-input'

const nativeSetValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

// 等 React 渲染与微任务（模拟 NodeView 的异步重新渲染）都完成
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

interface Harness {
  input: HTMLInputElement
  commits: string[]
  // 组字期间脚本对输入框值的改写（会打断真实输入法）
  scriptWrites: string[]
  setExternal: (value: string) => void
}

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  root?.unmount()
  container?.remove()
  root = null
  container = null
})

/** 外部值在微任务里才回到输入框，与 Tiptap NodeView 一致；naive 为改造前的直接受控写法 */
async function mount(initial: string, naive = false): Promise<Harness> {
  const commits: string[] = []
  let setExternal: (value: string) => void = () => {}

  function CompositionInput({ value, onCommit }: { value: string, onCommit: (value: string) => void }) {
    return createElement('input', useCompositionInput(value, onCommit))
  }
  function NaiveInput({ value, onCommit }: { value: string, onCommit: (value: string) => void }) {
    return createElement('input', { value, onChange: (event: { currentTarget: HTMLInputElement }) => onCommit(event.currentTarget.value) })
  }
  function Parent() {
    const [value, setValue] = useState(initial)
    setExternal = setValue
    const onCommit = (next: string) => {
      commits.push(next)
      queueMicrotask(() => setValue(next))
    }
    return createElement(naive ? NaiveInput : CompositionInput, { value, onCommit })
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(createElement(Parent))
  await flush()

  const input = container.querySelector('input')!
  const scriptWrites: string[] = []
  // React 的值追踪器装在实例属性上，在它外面再包一层，记录组字期间的脚本写入
  const tracked = Object.getOwnPropertyDescriptor(input, 'value') ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return tracked.get!.call(this) },
    set(value: string) {
      if (input.dataset.composing)
        scriptWrites.push(value)
      tracked.set!.call(this, value)
    },
  })
  return { input, commits, scriptWrites, setExternal: value => setExternal(value) }
}

async function compositionStart(input: HTMLInputElement) {
  input.dataset.composing = '1'
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  await flush()
}

async function compositionEnd(input: HTMLInputElement, data: string) {
  delete input.dataset.composing
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data }))
  await flush()
}

/** 模拟一次输入：浏览器先改值再派发 input 事件（绕过 React 的值追踪器，与真实输入一致） */
async function input(el: HTMLInputElement, value: string, isComposing = false) {
  nativeSetValue.call(el, value)
  el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing, data: value }))
  await flush()
}

const PINYIN = ['H', 'HD', 'HDR', 'HDRt', 'HDRtu', 'HDRtu\'p', 'HDRtu\'pi', 'HDRtu\'pian']

describe('useCompositionInput', () => {
  it('对照：直接受控且异步写回时，组字中途输入框会被脚本改写，拼音中间态被提交', async () => {
    const h = await mount('原注释', true)
    await compositionStart(h.input)
    for (const text of PINYIN)
      await input(h.input, `原注释${text}`, true)
    expect(h.scriptWrites.length).toBeGreaterThan(0)
    expect(h.commits).toContain('原注释HDRtu\'p')
  })

  it('组字期间不提交、不改写输入框，组字结束只提交最终文字', async () => {
    const h = await mount('原注释')
    await compositionStart(h.input)
    for (const text of PINYIN)
      await input(h.input, `原注释${text}`, true)
    expect(h.commits).toEqual([])
    await input(h.input, '原注释HDR图片', true)
    await compositionEnd(h.input, 'HDR图片')
    expect(h.scriptWrites).toEqual([])
    expect(h.commits).toEqual(['原注释HDR图片'])
    expect(h.input.value).toBe('原注释HDR图片')
  })

  it('compositionend 先于最后一次 input（Safari）时只提交一次', async () => {
    const h = await mount('')
    await compositionStart(h.input)
    await input(h.input, 'tu\'pian', true)
    nativeSetValue.call(h.input, '图片')
    await compositionEnd(h.input, '图片')
    await input(h.input, '图片')
    expect(h.commits).toEqual(['图片'])
    expect(h.input.value).toBe('图片')
  })

  it('普通输入与删除每次都立即提交', async () => {
    const h = await mount('ab')
    await input(h.input, 'abc')
    await input(h.input, 'ab')
    await input(h.input, '')
    expect(h.commits).toEqual(['abc', 'ab', ''])
    expect(h.input.value).toBe('')
  })

  it('外部值变化（撤销重做）同步到输入框，组字期间不覆盖', async () => {
    const h = await mount('旧')
    h.setExternal('撤销后')
    await flush()
    expect(h.input.value).toBe('撤销后')

    await compositionStart(h.input)
    await input(h.input, '撤销后zhu', true)
    h.setExternal('远端改动')
    await flush()
    expect(h.input.value).toBe('撤销后zhu')
    await input(h.input, '撤销后注', true)
    await compositionEnd(h.input, '注')
    expect(h.scriptWrites).toEqual([])
    expect(h.commits).toEqual(['撤销后注'])
  })
})
