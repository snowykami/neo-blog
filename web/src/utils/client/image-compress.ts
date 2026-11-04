// 上传前在浏览器内压缩图片：等级 0-10，0 不压缩，等级越大编码质量越低、文件越小

/** 压缩后图片的最大宽度，更宽的图片等比缩小到该宽度 */
export const COMPRESS_MAX_WIDTH = 1920

/** 默认压缩等级，对应「均衡」档 */
export const DEFAULT_COMPRESS_LEVEL = 5

/** 界面提供的压缩档位，从轻到重排列 */
export const COMPRESS_PRESETS = [
  { key: 'original', level: 0 },
  { key: 'high', level: 2 },
  { key: 'balanced', level: 5 },
  { key: 'small', level: 7 },
] as const

export type CompressPresetKey = (typeof COMPRESS_PRESETS)[number]['key']

// 只处理 canvas 能重新编码的位图格式；GIF 重新编码会丢失动画，SVG 是矢量图，均保持原样
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function isCompressibleImage(file: Blob) {
  return COMPRESSIBLE_TYPES.has(file.type)
}

export function clampCompressLevel(level: number) {
  return Math.min(Math.max(Math.round(level || 0), 0), 10)
}

/** 压缩等级对应的编码质量，并限制下限避免过度失真：level=1 -> 0.9，level=10 -> 0.1 */
export function compressQuality(level: number) {
  return Math.max(0.1, 1 - clampCompressLevel(level) / 10)
}

/** 把任意等级（如本地存储中的值或调用方传入的默认值）归到最接近的档位 */
export function snapToCompressPreset(level: unknown): number {
  if (typeof level !== 'number' || !Number.isFinite(level))
    return DEFAULT_COMPRESS_LEVEL
  return COMPRESS_PRESETS.reduce<number>(
    (best, preset) => (Math.abs(preset.level - level) < Math.abs(best - level) ? preset.level : best),
    COMPRESS_PRESETS[0].level,
  )
}

async function encodeImage(file: File, level: number): Promise<File> {
  let bitmap: ImageBitmap | undefined
  try {
    bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return file
    const scale = Math.min(1, COMPRESS_MAX_WIDTH / bitmap.width)
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    // PNG 转为 WebP（支持透明），JPEG / WebP 保留原类型
    const outputType = file.type === 'image/png' ? 'image/webp' : file.type
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, outputType, compressQuality(level)))
    // 没有变小时保留原图：原图已高度压缩，或浏览器不支持编码 WebP 而退回 PNG
    if (!blob || blob.size >= file.size)
      return file
    const ext = blob.type.split('/')[1] || file.name.split('.').pop()
    return new File([blob], file.name.replace(/\.[^/.]+$/, '') + (ext ? `.${ext}` : ''), { type: blob.type })
  }
  catch {
    // 解码失败（如文件损坏）时按原图上传，由后端决定是否接受
    return file
  }
  finally {
    bitmap?.close()
  }
}

interface CompressEntry {
  promise: Promise<File>
  result?: File
}

// 同一文件同一等级只压缩一次：界面预览算好的结果在上传时直接复用，展示的体积即实际上传的体积
const cache = new WeakMap<File, Map<number, CompressEntry>>()

/** 按压缩等级压缩图片；不需要压缩或不支持的格式原样返回 */
export function compressImage(file: File, level: number): Promise<File> {
  const clamped = clampCompressLevel(level)
  if (clamped === 0 || !isCompressibleImage(file))
    return Promise.resolve(file)
  let byLevel = cache.get(file)
  if (!byLevel) {
    byLevel = new Map()
    cache.set(file, byLevel)
  }
  let entry = byLevel.get(clamped)
  if (!entry) {
    const created: CompressEntry = {
      promise: encodeImage(file, clamped).then((result) => {
        created.result = result
        return result
      }),
    }
    entry = created
    byLevel.set(clamped, entry)
  }
  return entry.promise
}

/** 同步读取已完成的压缩结果，尚未压缩完成时返回 undefined */
export function peekCompressedImage(file: File, level: number): File | undefined {
  const clamped = clampCompressLevel(level)
  if (clamped === 0 || !isCompressibleImage(file))
    return file
  return cache.get(file)?.get(clamped)?.result
}
