// 歌词动效原型的共享代码（index.html 动效一览与 categories.html 分类与场景共用）：曲线、色板、逐字歌词行与强调特效的绘制、演示循环
// ================= 曲线（与 easing.ts 相同） =================
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-5) break; const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d }
    return sy(t)
  }
}
const swellIn = cubicBezier(0.2, 0.4, 0.58, 1), swellOut = cubicBezier(0.3, 0, 0.58, 1)
const swell = x => (x <= 0 || x >= 1) ? 0 : x < 0.5 ? swellIn(x / 0.5) : 1 - swellOut((x - 0.5) / 0.5)
const clamp01 = x => Math.min(1, Math.max(0, x))

// ================= 色板 / 字体 / 情绪（与 colors.ts、lyric-player.css、lyric-player.ts 一致） =================
const COLORS = { crimson: ['#ff5c6c', '绯红'], rose: ['#ff6f91', '玫瑰'], flame: ['#ff6a3d', '火焰'], sunset: ['#ff8a65', '夕阳'], coral: ['#ff9f80', '珊瑚'], maple: ['#ff7f3f', '枫叶'], amber: ['#ffb347', '琥珀'], peach: ['#ffa8a0', '蜜桃'], 'cherry-blossom': ['#ffb3c8', '樱花'], bauhinia: ['#e86fb0', '紫荆'], sunshine: ['#ffd54f', '阳光'], gold: ['#f5c542', '金色'], lemon: ['#fff176', '柠檬'], candlelight: ['#ffe0a3', '烛光'], 'spring-green': ['#a5e887', '春绿'], forest: ['#5fd38d', '森林'], mint: ['#8ef0c8', '薄荷'], jade: ['#3fcf9e', '翡翠'], aurora: ['#6effd0', '极光'], lake: ['#4fd1d9', '湖水'], sky: ['#74c0fc', '天空'], ocean: ['#3d9df5', '海洋'], 'starry-blue': ['#6c8cff', '星蓝'], midnight: ['#7b83eb', '午夜'], ice: ['#b5e8ff', '冰'], rain: ['#9bb7d4', '雨'], lavender: ['#c3a6ff', '薰衣草'], violet: ['#a77bff', '紫罗兰'], twilight: ['#b388eb', '暮光'], wisteria: ['#d4a5f5', '紫藤'], moonlight: ['#f0f4ff', '月光'], silver: ['#d7dde8', '银'] }
const FONTS = { song: ['宋体', '"Songti SC","Noto Serif SC",serif'], kai: ['楷体', '"Kaiti SC","LXGW WenKai",cursive'], xingkai: ['行楷', '"Xingkai SC","Zhi Mang Xing",cursive'], fangsong: ['仿宋', '"STFangsong","FangSong",serif'], round: ['圆体', '"Yuanti SC","ZCOOL KuaiLe",sans-serif'], mono: ['等宽', '"SF Mono",Menlo,monospace'], script: ['手写（英文）', '"Snell Roundhand","Dancing Script",cursive'] }
const MOODS = { calm: ['平静', '#cfe8ff'], bright: ['明亮', '#ffe6a8'], sad: ['伤感', '#d6ceff'], intense: ['激昂', '#ffc0b3'] }

// ================= 歌词行：逐字时间、擦除、上浮、强调（移植自 lyric-player.ts paintEmphasis） =================
function buildLine(parent, text, { ms = 380, holds = {}, cls = '', start = 0 } = {}) {
  const el = document.createElement('div')
  el.className = 'lyric ' + cls
  const chars = []
  let t = start
  ;[...text].forEach((c, i) => {
    const span = document.createElement('span')
    span.className = 'ch' + (c === ' ' ? ' sp' : '')
    span.textContent = c === ' ' ? ' ' : c
    const d = holds[i] ?? (c === ' ' ? 150 : ms)
    chars.push({ el: span, start: t, end: t + d, text: c })
    t += d
    el.appendChild(span)
  })
  parent.appendChild(el)
  return { el, chars, end: t }
}

/** 一组强调：chars[from, to)；effect / color / factor / styles / hold 同 LyricEmphasis */
function group(line, from, to, opt = {}) {
  if (from < 0 || to > line.chars.length || from >= to)
    throw new Error(`group [${from}, ${to}) out of range for ${line.chars.map(c => c.text).join('')}`)
  const g = { from, to, factor: 1, effect: 'swell', ...opt }
  g.start = line.chars[from].start
  g.end = line.chars[to - 1].end
  if (g.effect === 'shake' && opt.holdIndex != null) {
    const c = line.chars[opt.holdIndex]
    g.hold = { start: c.start, end: c.end }
  }
  return g
}

const WIPE = 'linear-gradient(90deg, var(--hi, #fff) var(--p, -18%), rgba(255,255,255,.32) calc(var(--p, -18%) + 18%))'

/** 心跳强度（0 ~ 1），同 word-effects.ts 的 heartbeatLevel（medium 节奏） */
function heartbeat(start, end, t) {
  const dur = Math.max(1, end - start), local = t - start
  if (local < 0 || local > dur + 300) return 0
  const P = dur / Math.max(2, Math.round(dur / 750)), ph = local % P
  const pulse = x => (x < 0 ? 0 : Math.exp(-x / 90) * clamp01(x / 45))
  return Math.max(pulse(ph), 0.7 * pulse(ph - 0.22 * P))
}

function holdVibrato(hold, t) {
  const onset = hold.start + Math.min(700, Math.max(250, (hold.end - hold.start) * 0.2))
  const release = t < hold.end ? 1 : Math.max(0, 1 - (t - hold.end) / 300)
  return { onset, release, amount: clamp01((t - onset) / 360) * release }
}

/** 绘制一行：擦除 + 演唱上浮 + 强调；glowBase 为没有颜色时辉光的颜色（情绪或封面取色），scale 为幅度倍数（导航栏用） */
function paintLine(line, groups, t, { glowBase = '#ffffff', amp = 1, lift = true } = {}) {
  const fx = new Map()
  for (const g of groups) {
    const dur = Math.max(1000, g.end - g.start)
    const count = g.to - g.from
    const stagger = dur * (g.effect === 'wave' ? 1 / 1.5 : 1 / 2.5) / Math.max(1, count)
    const tint = g.color ? COLORS[g.color][0] : null
    const charMs = Math.max(1, (g.end - g.start) / count)
    const hold = g.effect === 'shake' && g.hold ? holdVibrato(g.hold, t) : null
    for (let i = 0; i < count; i++) {
      const begin = g.start + stagger * i
      let v = swell((t - begin) / dur)
      if (hold && t >= begin + dur / 2) v = Math.max(v, hold.release)
      const lf = Math.sin(Math.PI * clamp01((t - begin + 400) / (dur * 1.4)))
      const f = g.factor
      let scale = 1, x = 0, y = -lf * 0.05, glow = 0, blur = 0, radius = 0.3
      if (g.effect === 'swell') { scale = 1 + v * 0.14 * f; x = -v * 0.03 * f * (count / 2 - i - 0.5); y -= v * 0.025 * f; glow = v * (0.25 + 0.45 * f) }
      else if (g.effect === 'glow') { scale = 1 + v * 0.04 * f; glow = v * (0.35 + 0.5 * f); radius = 0.45 }
      else if (g.effect === 'shake' && hold) {
        const w = Math.sin(2 * Math.PI * 5.5 * (t - hold.onset) / 1000 - i * 0.35)
        scale = 1 + v * 0.14 * f + w * hold.amount * 0.02 * f
        x = -v * 0.03 * f * (count / 2 - i - 0.5) + Math.cos(2 * Math.PI * 11 * (t - hold.onset) / 1000 + i) * hold.amount * 0.008 * f
        y -= v * 0.025 * f + w * hold.amount * 0.035 * f
        glow = v * (0.25 + 0.45 * f) + hold.amount * 0.12 * f
      }
      else if (g.effect === 'shake') { const ph = (t - begin) / 45; x = Math.sin(ph * 2.3 + i * 1.7) * 0.035 * f * v; y += Math.cos(ph * 1.9 + i * 1.3) * 0.025 * f * v; scale = 1 + v * 0.06 * f; glow = v * (0.15 + 0.25 * f) }
      else if (g.effect === 'focus') { const clear = clamp01((t - begin) / (dur * 0.6)); blur = (1 - clear) * (0.05 + 0.07 * f); scale = 1 + v * 0.05 * f; glow = v * (0.2 + 0.3 * f); radius = 0.4 }
      else if (g.effect === 'wave') { y = -lf * (0.08 + 0.14 * f); scale = 1 + lf * 0.05 * f }
      else if (g.effect === 'heartbeat') {
        // 「扑通-扑通」双拍：拍数按唱的时长（约 0.75 秒一拍，至少 2 拍），第二拍弱 30%、相隔 22% 拍长
        const beat = heartbeat(g.start, g.end, t)
        scale = 1 + v * 0.04 * f + beat * 0.16 * f; x = (i - (count - 1) / 2) * beat * 0.06 * f; glow = v * (0.2 + 0.2 * f) + beat * (0.3 + 0.35 * f)
      }
      else if (g.effect === 'shimmer' || g.effect === 'dissolve') { scale = 1 + v * 0.04 * f; glow = v * (0.25 + 0.3 * f) }
      // 流光：光带中心（以字为单位）从 -1 扫到 count + 1，扫两遍
      const sweep = g.effect === 'shimmer' ? (t - g.start) / 950 : -1
      const shine = sweep >= 0 && sweep < 2 ? (sweep % 1) * (count + 2) - 1 - i : null
      if (shine != null) glow = 0
      // 消散：字唱完 150ms 后在 600ms 内淡出、变虚、被吹向右侧
      const fade = g.effect === 'dissolve' ? clamp01((t - (g.start + charMs * (i + 1) + 150)) / 600) : 0
      if (fade > 0) { x += fade * 0.15; blur = Math.max(blur, fade * 0.08) }
      let color = null
      if (tint) { const k = Math.max(v * 0.85, t >= begin ? 0.6 : 0); if (k > 0.005) color = `color-mix(in srgb, ${tint} ${(k * 100).toFixed(1)}%, #ffffff)` }
      const ln = g.styles && g.styles.includes('underline') ? clamp01((t - g.start - charMs * i) / charMs) : null
      fx.set(g.from + i, { scale: 1 + (scale - 1) * amp, x: x * amp, y: y * amp, glow, blur: blur * amp, radius, color, glowColor: tint || glowBase, ln, shine, fade, g })
    }
  }
  line.chars.forEach((c, idx) => {
    const p = clamp01((t - c.start) / (c.end - c.start))
    c.el.style.setProperty('--p', (p * 118 - 18).toFixed(1) + '%')
    const e = fx.get(idx)
    if (e) {
      c.el.style.transform = `translate(${e.x.toFixed(3)}em, ${e.y.toFixed(3)}em) scale(${e.scale.toFixed(3)})`
      const filters = []
      if (e.blur > 0.002) filters.push(`blur(${e.blur.toFixed(3)}em)`)
      if (e.glow > 0.01) filters.push(`drop-shadow(0 0 ${e.radius}em color-mix(in srgb, ${e.glowColor} ${(e.glow * 100).toFixed(0)}%, transparent))`)
      c.el.style.filter = filters.join(' ')
      c.el.style.setProperty('--hi', e.color || '#fff')
      if (e.ln != null) c.el.style.setProperty('--line', e.ln.toFixed(3))
      // 只有流光、消散改背景与不透明度（其他演示可能自己设置了背景）
      if (e.g.effect === 'shimmer') {
        const pos = e.shine == null ? null : e.shine * 100
        c.el.style.backgroundImage = pos == null ? '' : `linear-gradient(105deg, transparent ${pos - 40}%, rgba(255,250,225,.98) ${pos}%, transparent ${pos + 40}%), ${WIPE}`
      }
      if (e.g.effect === 'dissolve') c.el.style.opacity = (1 - e.fade).toFixed(3)
    }
    else {
      // 普通词：唱到时轻微上浮并保持
      const up = lift ? -0.04 * clamp01((t - c.start + 200) / 400) : 0
      c.el.style.transform = `translateY(${up.toFixed(3)}em)`
      c.el.style.filter = ''
      c.el.style.setProperty('--hi', '#fff')
    }
  })
}

function applyStyles(line, g) {
  for (let i = g.from; i < g.to; i++) {
    const el = line.chars[i].el
    if (g.styles?.includes('bold')) el.style.fontWeight = 900
    if (g.styles?.includes('italic')) el.style.fontStyle = 'italic'
    if (g.styles?.includes('underline')) el.classList.add('u')
    if (g.font) el.style.fontFamily = FONTS[g.font][1]
  }
}

// ================= 卡片框架 =================
const playing = new Set()
function loop(now) {
  for (const card of [...playing]) {
    const t = now - card.t0 - 300
    card.demo.frame(Math.max(0, t), now)
    if (t > card.demo.duration + 800) { playing.delete(card); card.el.classList.remove('playing') }
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

// 演示已由 render 建好，这里只从头开始计时
function play(card) {
  card.t0 = performance.now()
  playing.add(card)
  card.el.classList.add('playing')
}
