import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ignoreComposingEscape, isComposingKey } from './ime'

function keydown(init: KeyboardEventInit, keyCode: number) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', ...init })
  Object.defineProperty(event, 'keyCode', { value: keyCode })
  return event
}

describe('isComposingKey', () => {
  it('组字中的按键', () => {
    expect(isComposingKey(keydown({ isComposing: true }, 13))).toBe(true)
  })

  it('确认候选词的回车在 Safari 中 isComposing 为 false、keyCode 为 229', () => {
    expect(isComposingKey(keydown({}, 229))).toBe(true)
  })

  it('普通回车', () => {
    expect(isComposingKey(keydown({}, 13))).toBe(false)
  })

  it('支持 React 合成事件', () => {
    const nativeEvent = keydown({}, 229)
    expect(isComposingKey({ nativeEvent } as unknown as React.KeyboardEvent)).toBe(true)
  })
})

describe('ignoreComposingEscape', () => {
  it('组字时按 Esc 只取消组字：阻止弹层关闭，不调用原处理函数', () => {
    const handler = vi.fn()
    const event = keydown({ key: 'Escape', isComposing: true, cancelable: true }, 229)
    ignoreComposingEscape(handler)(event)
    expect(event.defaultPrevented).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })

  it('普通 Esc 照常交给原处理函数', () => {
    const handler = vi.fn()
    const event = keydown({ key: 'Escape', cancelable: true }, 27)
    ignoreComposingEscape(handler)(event)
    expect(event.defaultPrevented).toBe(false)
    expect(handler).toHaveBeenCalledWith(event)
  })
})
