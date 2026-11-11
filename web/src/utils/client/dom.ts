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
    if (isRendered(el))
      return el
  }
  return first
}

function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function')
    return el.checkVisibility()
  return el.getClientRects().length > 0
}
