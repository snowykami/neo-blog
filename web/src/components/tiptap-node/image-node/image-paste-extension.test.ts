import { describe, expect, it } from 'vitest'
import { imageFilesOf } from './image-paste-extension'

/** 构造剪贴板 / 拖拽数据：files 与 items 分别对应浏览器的两种取文件方式 */
function fakeData(files: File[], { text = '', itemsOnly = false }: { text?: string, itemsOnly?: boolean } = {}) {
  return {
    files: itemsOnly ? [] : files,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as unknown as DataTransfer
}

const png = new File(['x'], 'a.png', { type: 'image/png' })
const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })

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
