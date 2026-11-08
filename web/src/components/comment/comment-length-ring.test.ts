import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CommentLengthRing } from './comment-length-ring'

// React 19 的 act 需要这个标记，happy-dom 环境里没有测试框架自动设置
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// 文案用 key 代替，断言的是显隐与状态而不是具体措辞
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}))

async function render(used: number, max: number) {
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(CommentLengthRing, { used, max }))
  })
  return container
}

describe('评论字数指示环', () => {
  it('剩余较多时不出现，避免一直占着工具栏', async () => {
    expect((await render(100, 500)).innerHTML).toBe('')
  })

  it('接近上限时出现，环内显示剩余字数', async () => {
    const container = await render(470, 500)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    expect(container.textContent).toBe('30')
    expect(container.querySelector('circle.stroke-destructive')).toBeNull()
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('length_remaining:{"remaining":30}')
  })

  it('超出上限时变红并显示超出多少（负数）', async () => {
    const container = await render(512, 500)
    expect(container.textContent).toBe('-12')
    // 超限的环用破坏色，标题里说明超出了多少
    expect(container.querySelector('circle.stroke-destructive')).not.toBeNull()
    expect(container.querySelector('[role="img"]')?.getAttribute('title')).toBe('length_over:{"over":12,"max":500}')
  })

  it('上限越小，出现的时机按比例提前', async () => {
    // 上限 100 时剩余 20 就出现（按比例），上限 10000 时剩余 50 才出现（封顶 50）
    expect((await render(80, 100)).textContent).toBe('20')
    expect((await render(9949, 10000)).innerHTML).toBe('')
    expect((await render(9950, 10000)).textContent).toBe('50')
  })
})
