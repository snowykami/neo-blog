/**
 * HDR 颜色素材：CSS 颜色本身亮不过 SDR 白，但浏览器（Chrome 等）会以 HDR 显示带 cICP 块的 PQ 编码 PNG，
 * 把它当作 background-image 铺在元素上，元素就能亮过 SDR 白。这里按颜色现场生成 1×1 的 16 位 PNG（BT.2020 + PQ），
 * 用 data URL 返回，不需要额外的静态资源；只在显示器支持 HDR 时使用（见 useHdrDisplay）
 */

// SDR 参考白的亮度（ITU-R BT.2408），gain 以它为单位
const SDR_WHITE_NITS = 203

/**
 * 音乐播放器各处的 HDR 高光亮度（SDR 白的倍数，1 倍约 203 nits），调亮度只改这里。
 * 超过屏幕峰值的部分由浏览器 / 系统截到这块屏幕此刻能给的最大亮度（macOS 的系统亮度越高，余量越小）；
 * 高亮度下彩色的各通道会分别截断，颜色往白色靠
 */
export const HDR_BRIGHTNESS = {
  // 正在唱的普通歌词（播放器页、悬浮小窗、灵动岛单行条）：长时间看也不刺眼
  lyric: 4,
  // 强调短语（含彩色上色、流光的光带）
  emphasis: 5,
  // 聚光灯下的点题句（播放器页、悬浮小窗）：要的就是晃眼，约 4000 nits，超过目前任何显示器的峰值
  spotlight: 20,
  // 灵动岛单行条唱到点题句（不演出聚光灯，只换亮度）
  stripSpotlight: 10,
  // 灵动岛的律动条与随拍染色层（只随节拍变不透明度）
  islandBeat: 4,
  // 播放器页的全屏粒子场景（WebGPU 输出，见 lib/hdr-canvas.ts；悬浮小窗与灵动岛的粒子不做 HDR）
  particles: 3,
  // 消散的颗粒、破碎的碎片刚出现时的亮度，随后按缓出曲线熄灭到 SDR 白再淡出（各处歌词都有）
  debris: 6,
  // 不是倍数：HDR 下未唱的字与其余行的不透明度再乘以它（亮的更亮、暗的更暗，拉开已唱与未唱的对比）
  dim: 0.6,
} as const

// sRGB（线性）→ BT.2020（线性）
const SRGB_TO_BT2020 = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0114],
  [0.0164, 0.0880, 0.8956],
] as const

function srgbToLinear(channel: number) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** SMPTE ST 2084（PQ）编码：nits → 0..1 */
export function pqEncode(nits: number) {
  const m1 = 2610 / 16384
  const m2 = 2523 / 4096 * 128
  const c1 = 3424 / 4096
  const c2 = 2413 / 4096 * 32
  const c3 = 2392 / 4096 * 32
  const y = Math.max(0, Math.min(1, nits / 10000)) ** m1
  return ((c1 + c2 * y) / (1 + c3 * y)) ** m2
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++)
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array) {
  let c = 0xFFFFFFFF
  for (const byte of bytes)
    c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: number[]) {
  const body = new Uint8Array([...Array.from(type, ch => ch.charCodeAt(0)), ...data])
  const crc = crc32(body)
  const len = data.length
  return [len >>> 24, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF, ...body, crc >>> 24, (crc >>> 16) & 0xFF, (crc >>> 8) & 0xFF, crc & 0xFF]
}

/** 生成 1×1 的 HDR PNG：rgb 为 sRGB 0..255，gain 为相对 SDR 白的亮度倍数 */
export function encodeHdrPng(rgb: readonly [number, number, number], gain: number): Uint8Array {
  const linear = rgb.map(srgbToLinear)
  const samples = SRGB_TO_BT2020.map(row => Math.round(pqEncode((row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]) * SDR_WHITE_NITS * gain) * 0xFFFF))
  // 扫描行：过滤类型 0 + 三个 16 位大端样本
  const raw = [0, ...samples.flatMap(v => [v >>> 8, v & 0xFF])]
  // zlib：不压缩的单个 stored 块
  let a = 1
  let b = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  const len = raw.length
  const zlib = [0x78, 0x01, 0x01, len & 0xFF, len >>> 8, ~len & 0xFF, (~len >>> 8) & 0xFF, ...raw, b >>> 8, b & 0xFF, a >>> 8, a & 0xFF]
  return new Uint8Array([
    ...PNG_SIGNATURE,
    // 1×1，16 位，RGB
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0]),
    // cICP：BT.2020 原色（9）、PQ 传递函数（16）、RGB（0）、全范围（1）
    ...chunk('cICP', [9, 16, 0, 1]),
    ...chunk('IDAT', zlib),
    ...chunk('IEND', []),
  ])
}

const rgbCache = new Map<string, readonly [number, number, number] | null>()

/** 把任意 CSS 颜色（#hex、rgb()、oklch() 等，不含 var()）解析成 sRGB 0..255；解析失败时返回 null */
export function parseCssColor(color: string): readonly [number, number, number] | null {
  const cached = rgbCache.get(color)
  if (cached !== undefined)
    return cached
  let rgb: readonly [number, number, number] | null = null
  try {
    // 借 canvas 把各种写法统一成 sRGB 字节
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.canvas.width = 1
      ctx.canvas.height = 1
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      rgb = [r, g, b]
    }
  }
  catch {
    rgb = null
  }
  rgbCache.set(color, rgb)
  return rgb
}

/**
 * 亮过 SDR 白的 CSS 颜色（color(srgb-linear …)，各通道乘以 gain），用于 float16 画布（见 lib/hdr-canvas.ts）；
 * gain 不大于 1 时为普通的 rgb()
 */
export function hdrCanvasColor([r, g, b]: readonly [number, number, number], gain: number, alpha = 1) {
  const a = Math.max(0, alpha).toFixed(3)
  if (gain <= 1)
    return `rgb(${r} ${g} ${b} / ${a})`
  const linear = (c: number) => (srgbToLinear(c) * gain).toFixed(4)
  return `color(srgb-linear ${linear(r)} ${linear(g)} ${linear(b)} / ${a})`
}

const urlCache = new Map<string, string | null>()

/** 把任意 CSS 颜色转成 HDR 素材的 data URL（用于 background-image）；解析失败时返回 null */
export function hdrColorUrl(color: string, gain: number): string | null {
  const key = `${color}|${gain}`
  const cached = urlCache.get(key)
  if (cached !== undefined)
    return cached
  const rgb = parseCssColor(color)
  const url = rgb ? `data:image/png;base64,${btoa(String.fromCharCode(...encodeHdrPng(rgb, gain)))}` : null
  urlCache.set(key, url)
  return url
}
