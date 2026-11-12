/**
 * 按 id 取当前显示着的元素。
 * Cache Components 下 Next 用 React 的 <Activity> 保留最近访问过的页面（隐藏而不卸载，返回时状态还在），
 * 文章 A → 文章 B 时 A 的正文仍在文档里（display: none），两篇的 #blog-content、同名的标题 id 会同时存在，
 * document.getElementById 可能拿到隐藏的那份。隐藏页面的 effect 已经清理，挂载 / 重新显示时运行的 effect 里，
 * 当前页面一定是显示着的那份；都不可见时退回第一个
 */
export function getVisibleElementById(id: string): HTMLElement | null {
  const first = document.getElementById(id)
  if (!first)
    return null
  const all = document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)
  if (all.length <= 1)
    return first
  for (const el of all) {
    if (isElementRendered(el))
      return el
  }
  return first
}

export function isElementRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function')
    return el.checkVisibility()
  return el.getClientRects().length > 0
}

/**
 * 按 id 取当前实际可见的元素；若文档中只有被 <Activity> 隐藏的旧页面元素（例如从文章页切回首页），
 * 返回 null 而不是隐藏节点，供全局挂载的组件（如回到顶部阅读进度）区分当前页是否存在正文
 */
export function getRenderedElementById(id: string): HTMLElement | null {
  const first = document.getElementById(id)
  if (!first)
    return null
  if (isElementRendered(first))
    return first
  const all = document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)
  for (const el of all) {
    if (isElementRendered(el))
      return el
  }
  return null
}

/** 滚动定位与阅读进度预留的导航栏高度（CSS 变量 --nav-h）与 1rem 间距 */
export function getScrollOffset(): number {
  const style = getComputedStyle(document.documentElement)
  const rem = Number.parseFloat(style.fontSize) || 16
  const navH = Number.parseFloat(style.getPropertyValue('--nav-h')) || 4.5
  return (navH + 1) * rem
}

export interface ArticleReadingMetrics {
  offset: number
  rect: DOMRect
  scrollable: number
  /** 0 ~ 1：正文顶端到达顶栏下方为 0，正文末尾滚到视口底部时为 1 */
  progress: number
}

/** 按当前视口测量正文容器（#blog-content / #page-content）的阅读进度，供顶栏灵动岛与回到顶部按钮共用 */
export function measureArticleReading(article: HTMLElement): ArticleReadingMetrics {
  const offset = getScrollOffset()
  const rect = article.getBoundingClientRect()
  const scrollable = Math.max(0, rect.height - (window.innerHeight - offset))
  const read = offset - rect.top
  const progress = Math.min(1, Math.max(0, scrollable > 0 ? read / scrollable : read >= 0 ? 1 : 0))
  return { offset, rect, scrollable, progress }
}
