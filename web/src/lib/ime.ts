import type * as React from 'react'

/**
 * 按键是否发生在输入法组字中：组字时的回车、方向键、Esc 是在确认 / 切换候选词或取消组字，不能当作快捷键处理
 * Safari 会在 compositionend 之后才派发确认用的 keydown（isComposing 已为 false），只能靠 keyCode 229 识别
 */
export function isComposingKey(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event
  return native.isComposing || native.keyCode === 229
}

/**
 * 包装 Radix 弹层（Dialog / Popover / Sheet）的 onEscapeKeyDown：组字时按 Esc 是在取消组字，不能关闭弹层
 * 否则正在编辑的内容会随弹层一起被丢弃（如公式弹层 Esc 即放弃修改）
 */
export function ignoreComposingEscape(handler?: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    if (isComposingKey(event)) {
      // Radix 只在事件未被阻止时关闭
      event.preventDefault()
      return
    }
    handler?.(event)
  }
}
