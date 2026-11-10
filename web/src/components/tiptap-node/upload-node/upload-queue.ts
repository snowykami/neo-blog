/**
 * 交给上传占位块的待上传文件：拖入视频等场景先插入占位块，占位块的节点视图挂载后取走文件开始上传（带进度与取消）。
 * 文件不能放进节点属性（会进入文档与撤销历史），这里按 uploadId 暂存在内存中，取走即删除
 */
const queued = new Map<string, File[]>()

export function queueUploadFiles(files: File[]): string {
  const id = crypto.randomUUID()
  queued.set(id, files)
  return id
}

export function takeQueuedUploadFiles(id: string | null | undefined): File[] | null {
  if (!id)
    return null
  const files = queued.get(id) ?? null
  queued.delete(id)
  return files
}

/**
 * 一个占位块内进行中的上传：占位块被删除、撤销或节点视图销毁时全部取消，
 * 避免上传在后台跑完后留下没有被任何内容引用的文件
 */
export class UploadControllers {
  private readonly active = new Set<AbortController>()

  start(): AbortController {
    const controller = new AbortController()
    this.active.add(controller)
    return controller
  }

  finish(controller: AbortController) {
    this.active.delete(controller)
  }

  abortAll() {
    this.active.forEach(controller => controller.abort())
    this.active.clear()
  }

  get size() {
    return this.active.size
  }
}
