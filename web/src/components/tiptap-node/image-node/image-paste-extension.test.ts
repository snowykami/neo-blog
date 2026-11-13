import type { Slice } from '@tiptap/pm/model'
import Image from '@tiptap/extension-image'
import { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { imageFilesOf, ImagePaste, routeDroppedFiles } from './image-paste-extension'

/** 构造剪贴板 / 拖拽数据：files 与 items 分别对应浏览器的两种取文件方式 */
function fakeData(files: File[], { text = '', html = '', itemsOnly = false }: { text?: string, html?: string, itemsOnly?: boolean } = {}) {
  return {
    files: itemsOnly ? [] : files,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
  } as unknown as DataTransfer
}

const png = new File(['x'], 'a.png', { type: 'image/png' })
const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
const mp4 = new File(['x'], 'a.mp4', { type: 'video/mp4' })

describe('粘贴 / 拖入的文件判定', () => {
  it('只有图片文件时按图片处理', () => {
    expect(imageFilesOf(fakeData([png]))).toEqual([png])
  })

  it('同时带有文字时保持默认粘贴（Word / 网页复制）', () => {
    expect(imageFilesOf(fakeData([png], { text: '一段文字' }))).toEqual([])
  })

  it('非图片文件不算图片', () => {
    expect(imageFilesOf(fakeData([pdf]))).toEqual([])
  })

  it('只写了 items 的浏览器也能取到文件', () => {
    expect(imageFilesOf(fakeData([png], { itemsOnly: true }))).toEqual([png])
  })

  it('没有数据时返回空', () => {
    expect(imageFilesOf(null)).toEqual([])
  })
})

describe('拖入文件的分流', () => {
  it('图片与视频分别处理，不支持的文件单独列出', () => {
    const route = routeDroppedFiles(fakeData([png, mp4, pdf]))
    expect(route).toEqual({ images: [png], videos: [mp4], unsupported: [pdf], handled: true })
  })

  it('拖入视频由我们处理（不再被吞掉）', () => {
    expect(routeDroppedFiles(fakeData([mp4]))).toMatchObject({ videos: [mp4], handled: true })
  })

  it('从网页拖图片（带有图片地址文字）按文件处理', () => {
    expect(routeDroppedFiles(fakeData([png], { text: 'https://example.com/a.png' }))).toMatchObject({ images: [png], handled: true })
  })

  it('只有不支持的文件时提示，并拦下浏览器默认行为', () => {
    expect(routeDroppedFiles(fakeData([pdf]))).toEqual({ images: [], videos: [], unsupported: [pdf], handled: true })
  })

  it('不支持的文件同时带有网页内容时交给默认处理', () => {
    expect(routeDroppedFiles(fakeData([pdf], { html: '<p>x</p>' }))).toEqual({ images: [], videos: [], unsupported: [], handled: false })
  })

  it('没有文件（拖文字、链接）交给默认处理', () => {
    expect(routeDroppedFiles(fakeData([], { text: 'hello' })).handled).toBe(false)
    expect(routeDroppedFiles(null).handled).toBe(false)
  })
})

describe('粘贴上传的取消', () => {
  const editors: Editor[] = []
  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy())
  })

  /** 粘贴一张图片：上传一直挂起，返回本次上传收到的 signal 与完成函数 */
  function pasteImage() {
    let signal: AbortSignal | undefined
    let resolve: (url: string) => void = () => {}
    const editor = new Editor({
      extensions: [StarterKit, Image, ImagePaste.configure({
        upload: (_file, _onProgress, abortSignal) => {
          signal = abortSignal
          return new Promise<string>((r) => {
            resolve = r
          })
        },
      })],
      content: '<p>前文</p><p></p>',
    })
    editors.push(editor)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const event = { clipboardData: fakeData([png]), preventDefault: () => {} } as unknown as ClipboardEvent
    const handled = editor.view.someProp('handlePaste', f => f(editor.view, event, {} as Slice))
    expect(handled).toBe(true)
    return { editor, signal: () => signal, resolve: (url: string) => resolve(url) }
  }

  it('占位所在内容被删除时取消上传', () => {
    const { editor, signal } = pasteImage()
    expect(signal()?.aborted).toBe(false)
    // 删掉占位所在的段落
    const { doc } = editor.state
    const last = doc.lastChild!
    editor.commands.deleteRange({ from: doc.content.size - last.nodeSize, to: doc.content.size })
    expect(signal()?.aborted).toBe(true)
  })

  it('无关的编辑不取消上传，完成后插入图片', async () => {
    const { editor, signal, resolve } = pasteImage()
    editor.commands.insertContentAt(1, '新')
    expect(signal()?.aborted).toBe(false)
    resolve('/f/1')
    await new Promise(r => setTimeout(r, 0))
    expect(signal()?.aborted).toBe(false)
    expect(editor.getHTML()).toContain('src="/f/1"')
  })

  it('编辑器销毁时取消上传', () => {
    const { editor, signal } = pasteImage()
    editor.destroy()
    expect(signal()?.aborted).toBe(true)
  })

  it('只读态拖入文件时阻止浏览器默认打开文件且不触发上传', () => {
    let uploaded = false
    const editor = new Editor({
      editable: false,
      extensions: [StarterKit, Image, ImagePaste.configure({
        upload: async () => {
          uploaded = true
          return '/f/1'
        },
      })],
      content: '<p>只读预览</p>',
    })
    editors.push(editor)
    let prevented = false
    const event = {
      dataTransfer: fakeData([png]),
      clientX: 0,
      clientY: 0,
      preventDefault: () => {
        prevented = true
      },
    } as unknown as DragEvent
    const handled = editor.view.someProp('handleDrop', f => f(editor.view, event, {} as Slice, false))
    expect(handled).toBe(true)
    expect(prevented).toBe(true)
    expect(uploaded).toBe(false)
  })
})
