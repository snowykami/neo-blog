import type { Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'

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

/**
 * 正在上传文件的占位块（按节点对象记录）：保存草稿时剔除，避免离开编辑页（上传随之取消）后草稿里留下一个空的占位块。
 * ProseMirror 的节点不可变，未改动的节点在后续文档中复用同一个对象，因此可以按对象识别；用 WeakSet，节点不再被引用后自动释放。
 * 只在上传结束（成功、失败、移除）时取消标记，不在节点视图卸载时取消：离开编辑页时先卸载节点视图、再取正文快照的顺序不确定
 */
const uploadingPlaceholders = new WeakSet<PMNode>()

export function markUploadingPlaceholder(node: PMNode, uploading: boolean) {
  if (uploading)
    uploadingPlaceholders.add(node)
  else
    uploadingPlaceholders.delete(node)
}

/** 去掉正在上传的占位块；没有时返回 null（调用方沿用原文档） */
export function stripUploadingPlaceholders(doc: PMNode): PMNode | null {
  const ranges: Array<[number, number]> = []
  doc.descendants((node, pos) => {
    if (uploadingPlaceholders.has(node)) {
      ranges.push([pos, pos + node.nodeSize])
      return false
    }
    return true
  })
  if (ranges.length === 0)
    return null
  const tr = new Transform(doc)
  // 从后往前删，前面的位置不受影响
  for (const [from, to] of ranges.reverse())
    tr.delete(from, to)
  return tr.doc
}
