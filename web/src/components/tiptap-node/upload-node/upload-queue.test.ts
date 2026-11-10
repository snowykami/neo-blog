import { describe, expect, it } from 'vitest'
import { queueUploadFiles, takeQueuedUploadFiles, UploadControllers } from './upload-queue'

const mp4 = new File(['x'], 'a.mp4', { type: 'video/mp4' })

describe('交给上传占位块的待上传文件', () => {
  it('取走一次后即删除', () => {
    const id = queueUploadFiles([mp4])
    expect(takeQueuedUploadFiles(id)).toEqual([mp4])
    expect(takeQueuedUploadFiles(id)).toBeNull()
  })

  it('没有 uploadId 时返回空', () => {
    expect(takeQueuedUploadFiles(null)).toBeNull()
    expect(takeQueuedUploadFiles('missing')).toBeNull()
  })
})

describe('占位块内进行中的上传', () => {
  it('销毁时取消全部进行中的上传，已结束的不受影响', () => {
    const controllers = new UploadControllers()
    const done = controllers.start()
    const running = controllers.start()
    controllers.finish(done)
    controllers.abortAll()
    expect(running.signal.aborted).toBe(true)
    expect(done.signal.aborted).toBe(false)
    expect(controllers.size).toBe(0)
  })
})
