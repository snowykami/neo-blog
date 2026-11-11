/**
 * 骨架换成正文时，入场动画只播一遍（见 SiteShell 的 skeleton 与 styles/animation.css 的 enter-fade-*）：
 * 没预取到正文的跳转先出骨架（loading.tsx、Suspense 的占位），骨架的外壳播一遍入场动画；正文到了替换骨架时是新挂上的外壳，
 * CSS 动画会从头再播一遍（又淡出、又上移一次）。这里在骨架被换下的同一批 DOM 变动里，让正文外壳的入场动画从骨架已经播到的进度接着播，
 * 骨架早已播完时直接停在终态。
 *
 * 用 MutationObserver 而不是组件里的 effect：整页加载时 Suspense 占位与正文的替换由流式 HTML 里的脚本完成，发生在水合之前；
 * MutationObserver 的回调在本轮任务结束、浏览器绘制之前执行，正文不会先以透明的样子闪一下。
 * 函数会被转成字符串内联到 <head>（entranceContinueScript），只能用浏览器原生 API、不能引用外部变量
 */
export function installEntranceContinue(doc: Document) {
  const SKELETON = '[data-site-shell="skeleton"]'
  const PAGE = '[data-site-shell="page"]'
  // 骨架外壳挂上的时间（入场动画从这时开始）
  const starts = new WeakMap<Element, number>()
  const each = (node: Node, selector: string, fn: (el: Element) => void) => {
    if (node.nodeType !== 1)
      return
    const el = node as Element
    if (el.matches(selector))
      fn(el)
    // 叶子元素（歌词、计时器等频繁变动的小节点）没有子元素，省掉一次查询
    if (el.firstElementChild)
      el.querySelectorAll(selector).forEach(fn)
  }
  new MutationObserver((records) => {
    const now = performance.now()
    // 被换下的骨架已经播了多久；-1 表示这一批没有骨架被换下
    let elapsed = -1
    for (const record of records) {
      record.addedNodes.forEach(node => each(node, SKELETON, el => starts.set(el, now)))
      record.removedNodes.forEach(node => each(node, SKELETON, (el) => {
        const start = starts.get(el)
        // 不知道何时挂上的（观察开始前就在）按已播完处理
        elapsed = Math.max(elapsed, start == null ? Infinity : now - start)
      }))
    }
    if (elapsed < 0)
      return
    for (const record of records) {
      record.addedNodes.forEach(node => each(node, PAGE, (shell) => {
        for (const child of Array.from(shell.children)) {
          if (!child.classList.contains('enter-fade-up'))
            continue
          for (const animation of child.getAnimations()) {
            if (elapsed === Infinity)
              animation.finish()
            else
              animation.currentTime = elapsed
          }
        }
      }))
    }
  }).observe(doc.documentElement, { childList: true, subtree: true })
}

// 放在 <head> 里尽早执行，整页加载时流式替换的骨架也能接上
export const entranceContinueScript = `(function(){try{(${installEntranceContinue.toString()})(document)}catch(_){}})()`
