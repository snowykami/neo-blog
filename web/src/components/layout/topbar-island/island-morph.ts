'use client'

/**
 * 灵动岛展开 / 收起的变换（参考 Apple 灵动岛：点按后胶囊本身长成面板，收起时再缩回胶囊）。
 * - 外壳：一块与面板同色、覆盖胶囊与面板两者范围的底板，用 clip-path 从胶囊的位置、尺寸与圆角平滑过渡到面板；
 *   面板内容用同样的 clip-path 按外壳与面板的交集裁剪，同时淡入（两者用同一种动画，主线程忙时也不会错开）
 * - 面板里标了 data-island-morph-fade 的是前景（文字、按钮等），只有它们淡入淡出，其余的（如播放器的模糊封面背景）全程显示，
 *   随形状一起伸缩，不会经过纯黑的外壳；没有标记时整个内容层淡入淡出（如阅读进度的面板本来就是纯黑）
 * - 共享元素（胶囊与面板里标了同一个 data-island-morph 的元素）：
 *   ghost 型（封面、进度环）复制胶囊里的那一个，从胶囊里的位置放大飞到面板里的位置，面板里的真身落地后再显示；
 *   胶囊里在转的封面带着此刻的角度起飞，沿最短的方向转正（收起时转到落地那一刻胶囊里封面的角度）；
 *   move 型（歌词、章节名）面板里的真身从胶囊里对应元素的位置平移回原位，随内容淡入；
 *   文字型（阅读进度的百分比，以及面板里的真身是替身时）复制胶囊里此刻显示的文字（保留原来的样式），按字号等比缩放、对齐到面板里文字的位置，
 *   颜色与字重同时过渡过去；替身（data-island-morph-standin，如歌词引擎延后挂载前的落点）的复制品展开落地后留在原处，
 *   等替身被真正的内容换下，滑到真正内容里同一段文字（属性值为它的选择器）的位置再淡出
 * - 收起反过来播
 * 全部用 Web Animations（transform、opacity、clip-path），不经过 React 渲染、不触发排版；系统要求减少动态效果时只淡入淡出
 */

const OPEN_MS = 420
const CLOSE_MS = 320
// 先快后慢的减速曲线（同 iOS 的弹出层），没有回弹，形变的边缘不会抖
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const FADE_MS = 160
// 面板（含外壳）在胶囊处淡入淡出的时长：展开时先在胶囊处淡入，盖严后胶囊再隐藏；收起后胶囊先在底下显示，面板再淡出（见 topbar-island.tsx）
export const CROSSFADE_MS = 120
// 展开时外壳与面板先保持胶囊的圆角，形状变到这个比例（按缓动后的进度，约 160ms，胶囊已经隐藏）之后才放大到面板的圆角：
// 面板的圆角比胶囊的大，提前放大会在左上角露出底下还没隐藏的胶囊端头。收起时按比例同步缩小（胶囊在收起播完后才显示）
const OPEN_RADIUS_HOLD = 0.9
// move 型：对齐到面板元素里的哪个高度（歌词区的焦点行在上方三分之一附近）
const MOVE_ANCHOR: Record<string, number> = { lyrics: 0.4, chapter: 0.5 }
// ghost 型中按文字对齐的（面板里的真身是替身时也按文字对齐）
const TEXT_KEYS = new Set(['percent'])
// ghost 型中需要从圆形过渡到面板圆角的（胶囊里的封面，可能在转）
const ROUND_START = new Set(['cover'])
// 转正的过程分成这么多段关键帧（每段按此刻的角度与圆角补偿放大，见 spinFrames）
const SPIN_STEPS = 12
// 展开落地后留下的复制品：最多等替身这么多帧，再用这么长时间淡出（与歌词引擎挂载时的淡入一致）
const LINGER_MAX_FRAMES = 120
const LINGER_FADE_MS = 200
// 等待面板定位完成、挂载时的重活（歌词排版等）做完：最多等这么多帧
const SETTLE_MAX_FRAMES = 6
const SETTLED_FRAME_MS = 24

type Direction = 'open' | 'close'

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))

/**
 * 等面板定位完成（Radix 定位前把外层放在视口外的 translate(0, -200%)），再等一帧没有长任务的帧（挂载时的排版做完），
 * 避免动画的头几帧被挂载的重活卡住
 */
export async function waitForSettled(panel: HTMLElement) {
  let last = await nextFrame()
  for (let i = 0; i < SETTLE_MAX_FRAMES; i++) {
    const now = await nextFrame()
    const positioned = !(panel.parentElement?.style.transform ?? '').includes('-200%')
    if (positioned && now - last < SETTLED_FRAME_MS)
      return
    last = now
  }
}

function insetFrom(outer: DOMRect, inner: DOMRect, radius: string) {
  // 内容按外壳与面板的交集裁剪：外壳在面板之外的部分不需要裁
  const top = Math.max(0, inner.top - outer.top)
  const left = Math.max(0, inner.left - outer.left)
  const right = Math.max(0, outer.right - inner.right)
  const bottom = Math.max(0, outer.bottom - inner.bottom)
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius})`
}

/** 两个矩形之间按比例 t 插值 */
function lerpRect(a: DOMRect, b: DOMRect, t: number) {
  const mix = (x: number, y: number) => x + (y - x) * t
  return new DOMRect(mix(a.left, b.left), mix(a.top, b.top), mix(a.width, b.width), mix(a.height, b.height))
}

function unionOf(a: DOMRect, b: DOMRect) {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top)
}

/** 放在 to 处的元素变成 from 的样子所需的 transform（以左上角为原点） */
function transformBetween(from: DOMRect, to: DOMRect) {
  const sx = from.width / Math.max(1, to.width)
  const sy = from.height / Math.max(1, to.height)
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`
}

/**
 * 转动着的元素（胶囊里的封面：CSS 动画一个周期转一圈）此刻的角度（度）与转速（度 / 毫秒，暂停时为 0）；没有在转的返回 null
 */
function spinOf(root: HTMLElement) {
  for (const animation of root.getAnimations({ subtree: true })) {
    const el = animation instanceof CSSAnimation ? (animation.effect as KeyframeEffect | null)?.target : null
    const period = Number(animation.effect?.getComputedTiming().duration)
    if (!el || !(period > 0))
      continue
    const transform = getComputedStyle(el).transform
    const { a, b } = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
    return { angle: Math.atan2(b, a) * 180 / Math.PI, speed: animation.playState === 'running' ? 360 / period * animation.playbackRate : 0 }
  }
  return null
}

/**
 * 圆形复制品从胶囊里的角度 angle 转正的关键帧（胶囊 → 面板的顺序）：外层的圆角同时从圆形（半径比 1）变到 radiusRatio，
 * 方形的图片转着时角会露出圆角框外的空白，按此刻的角度与圆角放大到正好盖满（圆形时不用放大，转正时也不用）
 */
function spinFrames(angle: number, radiusRatio: number): Keyframe[] {
  const delta = ((angle % 360) + 540) % 360 - 180
  return Array.from({ length: SPIN_STEPS + 1 }, (_, i) => {
    const p = i / SPIN_STEPS
    const alpha = delta * (1 - p)
    const rho = 1 - p * (1 - radiusRatio)
    const rad = alpha * Math.PI / 180
    return { transform: `rotate(${alpha.toFixed(2)}deg) scale(${((1 - rho) * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))) + rho).toFixed(4)})` }
  })
}

/**
 * 元素里此刻显示的文字（跳过 aria-hidden 的部分，如单行歌词里没在唱的行）：文字范围的左缘、顶边、竖直中心与第一段文字的字号、颜色、字重；
 * 没有文字时返回 null
 */
function visibleText(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let left = Infinity
  let top = Infinity
  let bottom = -Infinity
  let style: CSSStyleDeclaration | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    const hidden = parent?.closest('[aria-hidden="true"]')
    if (!parent || !node.textContent?.trim() || (hidden && hidden !== root && root.contains(hidden)))
      continue
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (!(rect.width > 0))
      continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
    style ??= getComputedStyle(parent)
  }
  const fontSize = style ? Number.parseFloat(style.fontSize) : 0
  return style && fontSize > 0 ? { left, top, centerY: (top + bottom) / 2, fontSize, color: style.color, fontWeight: style.fontWeight } : null
}

/**
 * 复制品挂在页面最外层，继承不到胶囊里的样式：带上原来的文字样式与中间祖先定义的 CSS 变量
 * （进度环的底环用 currentColor，不然在深色外壳上几乎看不见；单行歌词的字号字重跟随胶囊，颜色与特效取 --lyric-* 变量）
 */
function copyInherited(ghost: HTMLElement, source: HTMLElement, layer: HTMLElement) {
  const style = getComputedStyle(source)
  const base = getComputedStyle(layer)
  const { color, fontFamily, fontSize, fontStyle, fontWeight, letterSpacing, lineHeight } = style
  Object.assign(ghost.style, { color, fontFamily, fontSize, fontStyle, fontWeight, letterSpacing, lineHeight })
  for (let i = 0; i < style.length; i++) {
    const name = style[i]
    const value = style.getPropertyValue(name)
    if (name.startsWith('--') && value !== base.getPropertyValue(name))
      ghost.style.setProperty(name, value)
  }
}

/** 复制元素里此刻显示的部分：aria-hidden 的子树（如单行歌词里没在唱的上千个字）不复制 */
function cloneShown(el: Element): Node {
  const copy = el.cloneNode(false)
  for (const child of el.childNodes) {
    if (!(child instanceof Element))
      copy.appendChild(child.cloneNode(true))
    else if (child.getAttribute('aria-hidden') !== 'true')
      copy.appendChild(cloneShown(child))
  }
  return copy
}

// 展开落地后还留着的复制品：下一次展开或收起开始时直接撤下
const lingering = new Set<HTMLElement>()

interface Landed {
  ghost: HTMLElement
  clone: HTMLElement
  standIn: HTMLElement
  // 替身所在的容器：真正的内容挂在这里
  container: HTMLElement | null
  // 外层落地时的位移与缩放
  x: number
  y: number
  scale: number
}

const landedTransform = ({ x, y, scale }: Pick<Landed, 'x' | 'y' | 'scale'>) => `translate(${x}px, ${y}px) scale(${scale}, ${scale})`

/**
 * 等替身被换下（不在文档里了），在容器里找到真正内容里同一段文字（替身的 data-island-morph-standin 为它的选择器；
 * 重复的歌词取离得最近的），等它排好位置，复制品滑过去对齐顶边与左缘、同时淡出；找不到时原地淡出
 */
async function retire({ ghost, clone, standIn, container, x, y, scale }: Landed) {
  for (let i = 0; i < LINGER_MAX_FRAMES && standIn.isConnected && ghost.isConnected; i++)
    await nextFrame()
  const selector = standIn.dataset.islandMorphStandin
  const reference = selector ? clone.querySelector<HTMLElement>(selector) : null
  let offset = { dx: 0, dy: 0 }
  if (reference && container && ghost.isConnected) {
    let last: ReturnType<typeof visibleText> = null
    for (let i = 0; i < SETTLE_MAX_FRAMES; i++) {
      await nextFrame()
      const from = visibleText(reference)
      const to = Array.from(container.querySelectorAll<HTMLElement>(selector!))
        .filter(el => el.textContent === reference.textContent)
        .map(visibleText)
        .filter(text => !!text)
        .sort((a, b) => Math.abs(a.top - (from?.top ?? 0)) - Math.abs(b.top - (from?.top ?? 0)))[0]
      if (!from || !to)
        break
      if (last && Math.abs(to.left - last.left) < 0.5 && Math.abs(to.top - last.top) < 0.5) {
        offset = { dx: to.left - from.left, dy: to.top - from.top }
        break
      }
      last = to
    }
  }
  if (ghost.isConnected) {
    const frames = [{ transform: landedTransform({ x, y, scale }), opacity: 1 }, { transform: landedTransform({ x: x + offset.dx, y: y + offset.dy, scale }), opacity: 0 }]
    await ghost.animate(frames, { duration: LINGER_FADE_MS, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {})
  }
  ghost.remove()
  lingering.delete(ghost)
}

interface MorphOptions {
  direction: Direction
  // 胶囊（按钮本身，静止时的位置）与面板（Radix 的弹层内容）、面板里要淡入淡出的内容层
  capsule: HTMLElement
  panel: HTMLElement
  content: HTMLElement
  // 中途卸载（如切到别的活动）时取消：动画立即停止，返回的清理函数照常调用
  signal?: AbortSignal
}

export interface MorphResult {
  // 移除外壳与复制的元素、恢复面板的样式
  cleanup: () => void
  // 收起播完后，面板、外壳与复制的元素在胶囊的位置一起淡出（调用方先让胶囊在底下显示出来，两者交叉）
  fadeOut: () => Promise<void>
}

/** 播放一次展开或收起 */
export async function morphIsland({ direction, capsule, panel, content, signal }: MorphOptions): Promise<MorphResult> {
  const opening = direction === 'open'
  const restore: (() => void)[] = []
  const setStyle = (el: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
    const previous = Object.fromEntries(Object.keys(styles).map(key => [key, el.style[key as never]]))
    Object.assign(el.style, styles)
    restore.push(() => Object.assign(el.style, previous))
  }
  // 展开落地后留在原处的复制品与它等的替身
  const landed: Landed[] = []
  const cleanup = () => {
    restore.splice(0).reverse().forEach(fn => fn())
    for (const item of landed.splice(0))
      void retire(item)
  }
  // 外壳与飞行中的复制品：收尾时与面板一起淡出
  const overlays: HTMLElement[] = []
  // 转正的封面复制品与胶囊里的封面：收起后两者交叉淡化，复制品接着胶囊里此刻的角度一起转
  const spinning: { clone: HTMLElement, source: HTMLElement }[] = []
  const fadeOut = async () => {
    const fades = [panel, ...overlays].map(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CROSSFADE_MS, easing: 'linear', fill: 'forwards' }))
    for (const { clone, source } of spinning) {
      const spin = spinOf(source)
      if (spin)
        fades.push(clone.animate([{ transform: `rotate(${spin.angle}deg)` }, { transform: `rotate(${spin.angle + spin.speed * CROSSFADE_MS}deg)` }], { duration: CROSSFADE_MS, easing: 'linear', fill: 'forwards' }))
    }
    restore.push(() => fades.forEach(fade => fade.cancel()))
    await Promise.all(fades.map(fade => fade.finished.catch(() => {})))
  }
  const result: MorphResult = { cleanup, fadeOut }

  // 调用方挂载面板时先把它设为透明（等定位与排版），从这里开始由动画接管
  panel.style.opacity = ''
  lingering.forEach(ghost => ghost.remove())
  lingering.clear()
  if (reducedMotion()) {
    const fade = panel.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { duration: FADE_MS, fill: 'forwards' })
    await fade.finished.catch(() => {})
    restore.push(() => fade.cancel())
    return { cleanup, fadeOut: async () => {} }
  }

  const duration = opening ? OPEN_MS : CLOSE_MS
  const timing: KeyframeAnimationOptions = { duration, easing: EASE, fill: 'forwards' }
  const capsuleRect = capsule.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const panelStyle = getComputedStyle(panel)
  const capsuleRadius = `${capsuleRect.height / 2}px`
  const panelRadius = panelStyle.borderTopLeftRadius || '16px'
  const wrapper = panel.parentElement
  const layer = wrapper?.parentElement ?? document.body
  const zIndex = (wrapper && getComputedStyle(wrapper).zIndex) || panelStyle.zIndex || '50'

  // 外壳：插在弹层外层之前、同一层级，画在面板内容之下；铺满胶囊与面板的并集，靠裁剪显示出此刻的形状
  const union = unionOf(capsuleRect, panelRect)
  const shell = document.createElement('div')
  Object.assign(shell.style, { position: 'fixed', left: `${union.left}px`, top: `${union.top}px`, width: `${union.width}px`, height: `${union.height}px`, zIndex, pointerEvents: 'none', background: panelStyle.backgroundColor })
  // 面板标了形变底色（如播放器的模糊封面）时外壳铺上它的复制品：胶囊比面板宽出来的部分也是同样的背景，不是纯色
  const backdrop = content.querySelector<HTMLElement>('[data-island-morph-bg]')
  if (backdrop) {
    const copy = backdrop.cloneNode(true) as HTMLElement
    copy.removeAttribute('data-island-morph-bg')
    Object.assign(copy.style, { position: 'absolute', inset: '0', scale: '' })
    for (const el of copy.querySelectorAll<HTMLElement>('*'))
      el.style.animation = 'none'
    shell.append(copy)
  }
  layer.insertBefore(shell, wrapper ?? null)
  overlays.push(shell)
  restore.push(() => shell.remove())
  // 形变期间面板自身不画底色与阴影（由外壳画），不响应点击
  setStyle(panel, { background: 'transparent', boxShadow: 'none', pointerEvents: 'none' })

  const animations: Animation[] = []
  // 展开时中途加一帧：形状照常（两端按比例插值），圆角仍是胶囊的
  const held = lerpRect(capsuleRect, panelRect, OPEN_RADIUS_HOLD)
  const shellFrames: Keyframe[] = [
    { clipPath: insetFrom(union, capsuleRect, capsuleRadius) },
    ...(opening ? [{ clipPath: insetFrom(union, held, capsuleRadius), offset: OPEN_RADIUS_HOLD }] : []),
    { clipPath: insetFrom(union, panelRect, panelRadius) },
  ]
  const clipFrames: Keyframe[] = [
    { clipPath: insetFrom(panelRect, capsuleRect, capsuleRadius) },
    ...(opening ? [{ clipPath: insetFrom(panelRect, held, capsuleRadius), offset: OPEN_RADIUS_HOLD }] : []),
    { clipPath: `inset(0px 0px 0px 0px round ${panelRadius})` },
  ]
  // 前景在外壳长到一半前后淡入；收起时先淡出
  const fadeFrames = opening ? [{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }]
  const foreground = Array.from(content.querySelectorAll<HTMLElement>('[data-island-morph-fade]'))
  if (foreground.length > 0) {
    // 全程显示的背景（如模糊的封面）不要再播挂载时的淡入：直接显示，不恢复（恢复会让淡入重播一次；换封面时图片重新挂载，照常淡入）
    for (const img of content.querySelectorAll<HTMLElement>('img')) {
      if (!img.closest('[data-island-morph-fade]'))
        img.style.animation = 'none'
    }
  }
  animations.push(shell.animate(opening ? shellFrames : [...shellFrames].reverse(), timing))
  animations.push(panel.animate(opening ? clipFrames : [...clipFrames].reverse(), timing))
  // 展开时面板与外壳先在胶囊处淡入（胶囊的内容不会一下子被盖住），胶囊等它们盖严后再隐藏
  if (opening) {
    const appear = [{ opacity: 0 }, { opacity: 1, offset: CROSSFADE_MS / duration }, { opacity: 1 }]
    animations.push(shell.animate(appear, { duration, fill: 'forwards' }))
    animations.push(panel.animate(appear, { duration, fill: 'forwards' }))
  }
  for (const el of foreground.length > 0 ? foreground : [content])
    animations.push(el.animate(fadeFrames, { duration, fill: 'forwards' }))

  // 共享元素
  const capsuleParts = new Map(Array.from(capsule.querySelectorAll<HTMLElement>('[data-island-morph]'), el => [el.dataset.islandMorph!, el]))
  for (const target of panel.querySelectorAll<HTMLElement>('[data-island-morph]')) {
    const key = target.dataset.islandMorph!
    const source = capsuleParts.get(key)
    if (!source)
      continue
    const from = source.getBoundingClientRect()
    const to = target.getBoundingClientRect()
    if (!(from.width > 0 && to.width > 0))
      continue
    const standIn = target.hasAttribute('data-island-morph-standin')
    if (!standIn && key in MOVE_ANCHOR) {
      // 平移：胶囊里元素的左缘与竖直中心对齐到面板元素的左缘与锚点高度
      const dx = from.left - to.left
      const dy = from.top + from.height / 2 - (to.top + to.height * MOVE_ANCHOR[key])
      const frames = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }]
      animations.push(target.animate(opening ? frames : [...frames].reverse(), timing))
      continue
    }
    // 落地时外层的 transform（外层放在胶囊里元素的位置，以左上角为原点）：文字型按文字的左缘与竖直中心对齐，字号之比等比缩放；其余按包围盒对齐
    let landing = transformBetween(to, from)
    const textual = standIn || TEXT_KEYS.has(key)
    const texts = textual ? [visibleText(source), visibleText(target)] as const : null
    let textLanding: Pick<Landed, 'x' | 'y' | 'scale'> | null = null
    if (texts) {
      const [a, b] = texts
      if (!a || !b)
        continue
      const scale = b.fontSize / a.fontSize
      textLanding = { x: b.left - from.left - (a.left - from.left) * scale, y: b.centerY - from.top - (a.centerY - from.top) * scale, scale }
      landing = landedTransform(textLanding)
    }
    // 复制胶囊里的那一个（已经加载、显示着；面板里的图片可能还没加载完）飞到面板里的位置：外层负责位置、缩放与圆角裁剪，
    // 里面的复制品保留自己的样式（如进度环的旋转、歌词的擦亮进度）
    const round = ROUND_START.has(key)
    const ghost = document.createElement('div')
    Object.assign(ghost.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, zIndex, pointerEvents: 'none', transformOrigin: '0 0', overflow: round ? 'hidden' : '' })
    copyInherited(ghost, source, layer)
    // 文字只复制此刻显示的部分（单行歌词里没在唱的行不复制，也不用排版）
    const clone = (textual ? cloneShown(source) : source.cloneNode(true)) as HTMLElement
    clone.removeAttribute('data-island-morph')
    for (const el of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      // 胶囊里的封面在转：复制品不跟着转，角度由下面的转正动画给出；圆形改由外层的圆角裁剪，飞行中从圆形过渡到面板里的圆角
      el.style.animation = 'none'
      if (round)
        el.style.borderRadius = '0'
    }
    clone.style.margin = '0'
    ghost.append(clone)
    layer.insertBefore(ghost, wrapper?.nextSibling ?? null)
    overlays.push(ghost)
    if (standIn && opening && textLanding) {
      lingering.add(ghost)
      landed.push({ ghost, clone, standIn: target, container: target.parentElement, ...textLanding })
    }
    else {
      restore.push(() => ghost.remove())
    }
    setStyle(target, { visibility: 'hidden' })
    const scale = to.width / Math.max(1, from.width)
    // 圆角在外层的缩放之前生效，按缩放比例换算，落地时正好等于面板里的圆角
    const landingRadius = round ? (Number.parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0) / scale : 0
    const frames: Keyframe[] = [
      { transform: 'translate(0px, 0px) scale(1, 1)', ...(round && { borderRadius: '50%' }) },
      { transform: landing, ...(round && { borderRadius: `${landingRadius}px` }) },
    ]
    animations.push(ghost.animate(opening ? frames : [...frames].reverse(), timing))
    if (texts?.[0] && texts[1]) {
      // 文字的颜色与字重过渡到面板里的样子（如胶囊里半透明的百分比变成面板里白色加粗的）
      const [a, b] = texts
      const textFrames = [{ color: a.color, fontWeight: a.fontWeight }, { color: b.color, fontWeight: b.fontWeight }]
      animations.push(clone.animate(opening ? textFrames : [...textFrames].reverse(), timing))
    }
    const spin = round ? spinOf(source) : null
    if (spin) {
      // 胶囊那一端的角度：展开时为此刻的角度，收起时为落地那一刻胶囊里封面转到的角度
      const rotation = spinFrames(spin.angle + (opening ? 0 : spin.speed * duration), landingRadius / Math.max(1, from.width / 2))
      animations.push(clone.animate(opening ? rotation : [...rotation].reverse(), timing))
      spinning.push({ clone, source })
    }
  }

  signal?.addEventListener('abort', () => animations.forEach(animation => animation.cancel()), { once: true })
  await Promise.all(animations.map(animation => animation.finished.catch(() => {})))
  // 留下的复制品停在落地的位置（下面的清理会取消动画）
  for (const item of landed)
    item.ghost.style.transform = landedTransform(item)
  restore.push(() => animations.forEach(animation => animation.cancel()))
  return result
}
