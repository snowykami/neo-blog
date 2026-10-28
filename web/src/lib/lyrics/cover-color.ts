/**
 * 封面取色（播放器页）：从专辑封面挑出最有代表性的彩色，提亮后作为歌词辉光与背景呼吸的默认颜色（--lyric-accent），
 * 让没有 AI 标注的歌也有自己的色温。网易云封面 CDN 支持 CORS，并可用 ?param=48y48 取缩略图；读取失败或封面近乎无彩色时为 null
 */

const HUE_BINS = 24
const SAMPLE_SIZE = 24

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min)
    return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * 从 RGBA 像素中挑主色：按色相分桶，以「饱和度 × 居中的亮度」加权，取权重最大的桶的平均色，
 * 再统一提亮（亮度 0.72，饱和度 0.45 ~ 0.85），保证在深色界面上清晰；彩色像素太少时返回 null
 */
export function pickAccent(data: ArrayLike<number>): string | null {
  const weights: number[] = Array.from<number>({ length: HUE_BINS }).fill(0)
  const sums = Array.from({ length: HUE_BINS }, () => [0, 0, 0])
  let pixels = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200)
      continue
    pixels++
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    if (s < 0.15 || l < 0.08 || l > 0.95)
      continue
    const weight = s * (1 - Math.abs(2 * l - 1))
    const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))
    weights[bin] += weight
    sums[bin][0] += data[i] * weight
    sums[bin][1] += data[i + 1] * weight
    sums[bin][2] += data[i + 2] * weight
  }
  let best = 0
  for (let i = 1; i < HUE_BINS; i++) {
    if (weights[i] > weights[best])
      best = i
  }
  if (pixels === 0 || weights[best] < pixels * 0.03)
    return null
  const [r, g, b] = sums[best].map(sum => sum / weights[best])
  const [h, s] = rgbToHsl(r, g, b)
  return hslToHex(h, Math.min(0.85, Math.max(0.45, s)), 0.72)
}

const cache = new Map<string, Promise<string | null>>()

/** 读取封面主色（按地址缓存） */
export function loadCoverAccent(url: string): Promise<string | null> {
  let result = cache.get(url)
  if (!result) {
    result = new Promise((resolve) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = SAMPLE_SIZE
          canvas.height = SAMPLE_SIZE
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (!ctx)
            return resolve(null)
          ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
          resolve(pickAccent(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data))
        }
        catch {
          // 封面不支持 CORS 时画布被污染，读不到像素
          resolve(null)
        }
      }
      image.onerror = () => resolve(null)
      image.src = /music\.126\.net/.test(url) && !url.includes('?') ? `${url}?param=48y48` : url
    })
    cache.set(url, result)
  }
  return result
}
