import type { Root } from 'react-dom/client'
import type { UserBrief } from '@/models/user'
import { createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_COMMENT_MENTIONS, MENTION_DEBOUNCE_MS, useMention } from './use-mention'

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

/** 与 comment-input.tsx 相同的接法：onChange 后等一拍再同步光标，keyup 与 IME 事件一并接入 */
async function mount(options: {
  contextUsers?: UserBrief[]
  currentUserId?: number
  onExceedLimit?: () => void
} = {}) {
  const state: { mention: Mention | null, value: string } = { mention: null, value: '' }
  function Harness() {
    const [value, setValue] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const mention = useMention({
      value,
      textareaRef,
      onChange: setValue,
      contextUsers: options.contextUsers,
      currentUserId: options.currentUserId,
      onExceedLimit: options.onExceedLimit,
    })
    state.mention = mention
    state.value = value
    return createElement('textarea', {
      ref: textareaRef,
      value,
      onChange: (event: { target: HTMLTextAreaElement }) => {
        setValue(event.target.value)
        window.setTimeout(mention.syncFromCursor, 0)
      },
      onCompositionStart: () => mention.setComposing(true),
      onCompositionEnd: () => mention.setComposing(false),
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
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  textarea.dispatchEvent(down)
  await sleep(0)
  textarea.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
  await sleep(10)
  return down
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
    expect(state.mention!.activeUsernames).toEqual(['albert'])
  })

  it('刚输入空 @ 时 0ms 弹出当前上下文候选且不请求搜索接口（排除自己与已提及者）', async () => {
    const contextUsers: UserBrief[] = [
      { id: 10, username: 'me', nickname: '我' },
      { id: 11, username: 'author', nickname: '站长' },
      { id: 12, username: 'reader', nickname: '读者' },
    ]
    const { state, textarea } = await mount({ contextUsers, currentUserId: 10 })
    await type(textarea, '@')
    expect(state.mention!.open).toBe(true)
    expect(state.mention!.isEmptyQuery).toBe(true)
    expect(state.mention!.loading).toBe(false)
    expect(state.mention!.candidates.map(u => u.username)).toEqual(['author', 'reader'])
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).not.toHaveBeenCalled()

    await press(textarea, 'Enter')
    expect(state.value).toBe('@author ')
    // 再次输入空 @ 时，已提及过的 author 不再重复推荐
    await type(textarea, '@author @')
    expect(state.mention!.candidates.map(u => u.username)).toEqual(['reader'])
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

  it('中文输入法组字期间不抢按键，选词上屏（无 keyup）后立即同步并触发搜索', async () => {
    searchUsers.mockResolvedValue({ data: { users: [{ id: 21, username: 'xiaoxue', nickname: '小雪' }] } })
    const { state, textarea } = await mount({
      contextUsers: [{ id: 11, username: 'author', nickname: '站长' }],
    })
    await type(textarea, '@')
    expect(state.mention!.open).toBe(true)

    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await sleep(0)
    expect(state.mention!.open).toBe(false)

    // 组字期间 input 先于 compositionend 触发（模拟 Chrome / Safari 鼠标点选输入法候选词，无后续 keyup）
    nativeSetValue.call(textarea, '@小雪')
    textarea.setSelectionRange(3, 3)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    const enterDuringIme = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
    textarea.dispatchEvent(enterDuringIme)
    expect(enterDuringIme.defaultPrevented).toBe(false)

    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).toHaveBeenCalledWith({ query: '小雪' })
    expect(state.mention!.open).toBe(true)
    expect(state.mention!.candidates.map(u => u.username)).toEqual(['xiaoxue'])
  })

  it('工具栏 triggerMention 自动补前导空格，且达到 3 人上限时拦截提示', async () => {
    const onExceedLimit = vi.fn()
    const { state, textarea } = await mount({
      contextUsers: [
        { id: 1, username: 'u1', nickname: 'U1' },
        { id: 2, username: 'u2', nickname: 'U2' },
        { id: 3, username: 'u3', nickname: 'U3' },
        { id: 4, username: 'u4', nickname: 'U4' },
      ],
      onExceedLimit,
    })
    await type(textarea, '写得真好')
    state.mention!.triggerMention()
    await sleep(10)
    expect(state.value).toBe('写得真好 @')
    expect(state.mention!.open).toBe(true)

    await press(textarea, 'Enter')
    expect(state.value).toBe('写得真好 @u1 ')

    state.mention!.triggerMention()
    await sleep(10)
    await press(textarea, 'Enter')
    state.mention!.triggerMention()
    await sleep(10)
    await press(textarea, 'Enter')

    expect(state.mention!.mentionCount).toBe(MAX_COMMENT_MENTIONS)
    expect(state.mention!.atLimit).toBe(true)
    expect(state.mention!.mentions()).toEqual([1, 2, 3])

    // 已满 3 人再点 @ 按钮：触发上限提示，不再插入新的 @
    const before = state.value
    state.mention!.triggerMention()
    await sleep(10)
    expect(onExceedLimit).toHaveBeenCalledTimes(1)
    expect(state.value).toBe(before)
  })

  it('回退关键词时直接命中会话缓存，不重复请求后端', async () => {
    const { state, textarea } = await mount()
    await type(textarea, '@al')
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).toHaveBeenCalledTimes(1)

    await type(textarea, '@ali')
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).toHaveBeenCalledTimes(2)

    // 退格回到 @al：立即命中缓存，loading 为 false 且不再发第 3 次请求
    await type(textarea, '@al')
    expect(state.mention!.loading).toBe(false)
    expect(state.mention!.candidates).toHaveLength(3)
    await sleep(MENTION_DEBOUNCE_MS + 50)
    expect(searchUsers).toHaveBeenCalledTimes(2)
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
