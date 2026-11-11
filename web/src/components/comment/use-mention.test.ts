import type { Root } from 'react-dom/client'
import type { UserBrief } from '@/models/user'
import { createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MENTION_DEBOUNCE_MS, useMention } from './use-mention'

const searchUsers = vi.fn()
vi.mock('@/api/user', () => ({ searchUsers: (...args: unknown[]) => searchUsers(...args) }))

const users: UserBrief[] = ['alice', 'alan', 'albert'].map((username, index) => ({
  id: index + 1,
  username,
  nickname: username,
  avatarUrl: '',
  isAi: false,
} as UserBrief))

const nativeSetValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Mention = ReturnType<typeof useMention>
let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  searchUsers.mockReset()
  searchUsers.mockResolvedValue({ data: { users } })
})

afterEach(() => {
  root?.unmount()
  container?.remove()
  root = null
  container = null
})

/** 与 comment-input.tsx 相同的接法：onChange 后等一拍再同步光标，keyup 时也同步 */
async function mount() {
  const state: { mention: Mention | null, value: string } = { mention: null, value: '' }
  function Harness() {
    const [value, setValue] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const mention = useMention({ value, textareaRef, onChange: setValue })
    state.mention = mention
    state.value = value
    return createElement('textarea', {
      ref: textareaRef,
      value,
      onChange: (event: { target: HTMLTextAreaElement }) => {
        setValue(event.target.value)
        window.setTimeout(mention.syncFromCursor, 0)
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => mention.handleKeyDown(event),
      onKeyUp: mention.syncFromCursor,
    })
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(createElement(Harness))
  await sleep(0)
  const textarea = container.querySelector('textarea')!
  return { state, textarea }
}

async function type(textarea: HTMLTextAreaElement, value: string) {
  textarea.focus()
  nativeSetValue.call(textarea, value)
  textarea.setSelectionRange(value.length, value.length)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(10)
}

async function press(textarea: HTMLTextAreaElement, key: string) {
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await sleep(0)
  textarea.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
  await sleep(10)
}

describe('useMention', () => {
  it('方向键移动选中项后不被重置，也不重新搜索', async () => {
    const { state, textarea } = await mount()
    await type(textarea, '@al')
    // 防抖期间已经打开，显示「搜索中」
    expect(state.mention!.open).toBe(true)
    expect(state.mention!.loading).toBe(true)
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).toHaveBeenCalledTimes(1)
    expect(state.mention!.candidates).toHaveLength(3)
    expect(state.mention!.loading).toBe(false)

    await press(textarea, 'ArrowDown')
    await press(textarea, 'ArrowDown')
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(state.mention!.activeIndex).toBe(2)
    expect(searchUsers).toHaveBeenCalledTimes(1)

    await press(textarea, 'Enter')
    expect(state.value).toBe('@albert ')
    expect(state.mention!.open).toBe(false)
    expect(state.mention!.mentions()).toEqual([3])
  })

  it('没有匹配时仍打开，显示「没有匹配」', async () => {
    searchUsers.mockResolvedValue({ data: { users: [] } })
    const { state, textarea } = await mount()
    await type(textarea, '@zz')
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(state.mention!.open).toBe(true)
    expect(state.mention!.loading).toBe(false)
    expect(state.mention!.candidates).toHaveLength(0)
  })

  it('esc 收起后松开按键不会重新弹出，继续输入才弹出', async () => {
    const { state, textarea } = await mount()
    await type(textarea, '@al')
    await sleep(MENTION_DEBOUNCE_MS + 50)
    await press(textarea, 'Escape')
    expect(state.mention!.open).toBe(false)
    await type(textarea, '@ali')
    expect(state.mention!.open).toBe(true)
  })

  it('编辑时原有的提及按正文裁剪：删掉的人不再提交', async () => {
    const { state, textarea } = await mount()
    state.mention!.seed([{ id: 7, username: 'bob' }, { id: 8, username: 'carol' }])
    await type(textarea, '@bob 你好')
    expect(state.mention!.mentions()).toEqual([7])
    await type(textarea, '你好 @bob.')
    expect(state.mention!.mentions()).toEqual([7])
    await type(textarea, '你好 @bobby')
    expect(state.mention!.mentions()).toEqual([])
  })
})
