/**
 * Canvas 2D 的 HDR 输出：2D canvas 目前不能输出 HDR（toneMapping: extended 不生效），WebGPU canvas 可以。
 * 做法是 2D 照常绘制在一张不显示的 float16 画布上（colorType: 'float16'，可以用 color(srgb-linear …) 存下超过 1.0 的颜色），
 * 每帧把它整张拷进页面上 WebGPU canvas 的当前纹理（copyExternalImageToTexture，不需要着色器），由 WebGPU canvas 以 HDR 显示。
 * 一个 canvas 元素只能有一种上下文：先用临时 canvas 探测能力，支持时才在页面上的 canvas 上取 webgpu 上下文，不支持时页面上的 canvas 仍可用 2D
 */

export interface HdrCanvasPresenter {
  /** 把 source 整张拷到页面上的 canvas（尺寸须与 resize 设置的一致） */
  present: (source: HTMLCanvasElement) => void
  /** 页面上 canvas 的像素尺寸（与绘制画布一致） */
  resize: (width: number, height: number) => void
  dispose: () => void
}

const FORMAT: GPUTextureFormat = 'rgba16float'
// GPUTextureUsage 的 RENDER_ATTACHMENT | COPY_DST（TypeScript 的 DOM 类型里还没有这个全局常量）
const CANVAS_USAGE = 0x10 | 0x02

/** TypeScript 的 DOM 类型里 getContext 还没有 webgpu 的重载 */
function webgpuContext(canvas: HTMLCanvasElement) {
  return canvas.getContext('webgpu') as GPUCanvasContext | null
}

/** 探测：能否创建 extended 色调映射的 WebGPU canvas（Chrome 129+；Safari、Firefox 目前多数不行） */
function supportsExtended(device: GPUDevice) {
  const probe = webgpuContext(document.createElement('canvas'))
  if (!probe)
    return false
  probe.configure({ device, format: FORMAT, toneMapping: { mode: 'extended' } })
  const ok = probe.getConfiguration()?.toneMapping?.mode === 'extended'
  probe.unconfigure()
  return ok
}

let sharedDevice: Promise<GPUDevice | null> | null = null

/**
 * 全页共用的 GPU 设备（粒子、各处歌词引擎的碎屑共用）：创建要几十毫秒，碎屑这类转瞬即逝的效果等不起，
 * 第一次需要时创建（或由 prewarmHdrDevice 提前创建）后一直复用；不支持 extended 色调映射时为 null；设备丢失后下次重新创建
 */
function getSharedDevice() {
  sharedDevice ??= (async () => {
    if (!('gpu' in navigator))
      return null
    try {
      const adapter = await navigator.gpu.requestAdapter()
      const device = await adapter?.requestDevice()
      if (!device)
        return null
      if (!supportsExtended(device)) {
        device.destroy()
        return null
      }
      void device.lost.then(() => {
        sharedDevice = null
      })
      return device
    }
    catch {
      return null
    }
  })()
  return sharedDevice
}

/** 提前创建共用的 GPU 设备（开启 HDR 高光时调用），之后创建 HDR 输出几乎是同步的 */
export function prewarmHdrDevice() {
  void getSharedDevice()
}

/**
 * 在页面上的 canvas 上创建 HDR 输出；不支持时返回 null（不会动页面上的 canvas，调用方仍可在它上面取 2D 上下文）。
 * onLost：GPU 设备丢失（驱动重置、显卡切换等）或上下文失效时调用，调用方应退回 2D；
 * signal：调用方已不需要时中止（异步初始化期间可能已被清理），中止后不再动页面上的 canvas，返回 null
 */
export async function createHdrCanvasPresenter(canvas: HTMLCanvasElement, onLost: () => void, signal?: AbortSignal): Promise<HdrCanvasPresenter | null> {
  const device = await getSharedDevice()
  if (!device || signal?.aborted)
    return null
  const ctx = webgpuContext(canvas)
  if (!ctx)
    return null
  ctx.configure({
    device,
    format: FORMAT,
    alphaMode: 'premultiplied',
    toneMapping: { mode: 'extended' },
    usage: CANVAS_USAGE,
  })
  let disposed = false
  void device.lost.then(() => {
    if (!disposed)
      onLost()
  })
  return {
    present(source) {
      if (disposed || source.width === 0 || source.height === 0 || source.width !== canvas.width || source.height !== canvas.height)
        return
      try {
        device.queue.copyExternalImageToTexture(
          { source },
          { texture: ctx.getCurrentTexture(), premultipliedAlpha: true, colorSpace: 'srgb' },
          [source.width, source.height],
        )
      }
      catch {
        // 上下文失效（被别处重新配置等）：不再逐帧报错，交给调用方退回 2D
        disposed = true
        onLost()
      }
    },
    resize(width, height) {
      canvas.width = width
      canvas.height = height
    },
    dispose() {
      // 设备全页共用，不销毁；也不 unconfigure：同一个 canvas 只有一个 webgpu 上下文，可能已被后来创建的输出重新配置（开发模式下 effect 会执行两遍）
      disposed = true
    },
  }
}
