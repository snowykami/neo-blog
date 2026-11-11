import { CanceledError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFile } from './file'

const client = vi.hoisted(() => ({ post: vi.fn(), delete: vi.fn() }))
vi.mock('./client', () => ({ default: client }))
// 不压缩，原样返回
vi.mock('@/utils/client/image-compress', () => ({ compressImage: async (file: File) => file, DEFAULT_COMPRESS_LEVEL: 5 }))

const file = new File(['x'.repeat(10)], 'a.mp4', { type: 'video/mp4' })
const ok = { data: { data: { id: 7, hash: 'h', url: '/f/7' } } }

interface PostConfig {
  signal: AbortSignal
  timeout: number
  onUploadProgress: (event: { loaded: number, total?: number }) => void
}

/** 可控的上传请求：记下配置，由测试决定何时返回；请求被中断时按 axios 行为以取消失败 */
function pendingPost() {
  let resolve!: (value: unknown) => void
  let config!: PostConfig
  client.post.mockImplementationOnce((_url: string, _data: unknown, cfg: PostConfig) => {
    config = cfg
    return new Promise((res, rej) => {
      resolve = res
      cfg.signal.addEventListener('abort', () => rej(new CanceledError()))
    })
  })
  return { resolve: (value: unknown) => resolve(value), config: () => config }
}

describe('uploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.delete.mockResolvedValue({ data: {} })
  })

  it('不使用全局超时，并上报进度', async () => {
    const post = pendingPost()
    const progress: number[] = []
    const promise = uploadFile({ file, onProgress: p => progress.push(p) })
    await vi.waitFor(() => expect(client.post).toHaveBeenCalled())
    expect(post.config().timeout).toBe(0)
    post.config().onUploadProgress({ loaded: 5, total: 10 })
    post.config().onUploadProgress({ loaded: 10, total: 10 })
    post.resolve(ok)
    await expect(promise).resolves.toEqual(ok.data)
    expect(progress).toEqual([50, 100])
  })

  it('请求体还没发完时取消：中断请求，不删除文件', async () => {
    const post = pendingPost()
    const controller = new AbortController()
    const promise = uploadFile({ file, signal: controller.signal })
    await vi.waitFor(() => expect(client.post).toHaveBeenCalled())
    post.config().onUploadProgress({ loaded: 3, total: 10 })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(CanceledError)
    expect(post.config().signal.aborted).toBe(true)
    expect(client.delete).not.toHaveBeenCalled()
  })

  it('请求体已发完后取消：等响应回来再删掉刚保存的文件，并按取消抛出', async () => {
    const post = pendingPost()
    const controller = new AbortController()
    const promise = uploadFile({ file, signal: controller.signal })
    await vi.waitFor(() => expect(client.post).toHaveBeenCalled())
    post.config().onUploadProgress({ loaded: 10, total: 10 })
    controller.abort()
    expect(post.config().signal.aborted).toBe(false)
    post.resolve(ok)
    await expect(promise).rejects.toBeInstanceOf(CanceledError)
    expect(client.delete).toHaveBeenCalledWith('/file/f/7')
  })

  it('开始前已取消时不发请求', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(uploadFile({ file, signal: controller.signal })).rejects.toBeInstanceOf(CanceledError)
    expect(client.post).not.toHaveBeenCalled()
  })
})
