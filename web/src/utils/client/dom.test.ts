import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRenderedElementById, measureArticleReading } from './dom'

describe('dom 阅读进度与可见节点查询', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('getRenderedElementById 忽略被隐藏的缓存页面节点，并在全部隐藏时返回 null', () => {
    const hidden = document.createElement('article')
    hidden.id = 'blog-content'
    Object.defineProperty(hidden, 'checkVisibility', { value: () => false })
    document.body.appendChild(hidden)

    expect(getRenderedElementById('blog-content')).toBeNull()

    const visible = document.createElement('article')
    visible.id = 'blog-content'
    Object.defineProperty(visible, 'checkVisibility', { value: () => true })
    document.body.appendChild(visible)

    expect(getRenderedElementById('blog-content')).toBe(visible)
  })

  it('measureArticleReading 按正文顶部到末尾触底计算 0~1 阅读进度', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    document.documentElement.style.fontSize = '16px'
    document.documentElement.style.setProperty('--nav-h', '4')
    // offset = (4 + 1) * 16 = 80；可视阅读高度 = 800 - 80 = 720
    const article = document.createElement('article')
    let top = 200
    const height = 1720 // scrollable = 1720 - 720 = 1000
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }))

    // 尚未读到正文顶端
    expect(measureArticleReading(article).progress).toBe(0)

    // 读过一半可滚动距离（read = 80 - (-420) = 500）
    top = -420
    expect(measureArticleReading(article).progress).toBeCloseTo(0.5, 5)

    // 正文末尾恰好到达视口底部（bottom = -920 + 1720 = 800）
    top = -920
    expect(measureArticleReading(article).progress).toBe(1)

    // 继续往下滚进评论区，保持 100%
    top = -1400
    expect(measureArticleReading(article).progress).toBe(1)
  })
})
