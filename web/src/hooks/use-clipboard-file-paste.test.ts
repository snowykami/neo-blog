import { describe, expect, it } from 'vitest'
import { pastedFilesOf, withPastedFileNames } from './use-clipboard-file-paste'

const NOW = new Date(2026, 9, 25, 16, 18, 30)

describe('withPastedFileNames', () => {
  it('重命名剪贴板里无意义的图片名', () => {
    const [file] = withPastedFileNames([new File(['a'], 'image.png', { type: 'image/png' })], NOW)
    expect(file.name).toBe('screenshot-20261025-161830.png')
  })

  it('多文件时追加序号，非图片使用 pasted 前缀', () => {
    const files = withPastedFileNames([
      new File(['a'], 'image.png', { type: 'image/png' }),
      new File(['b'], 'blob', { type: 'application/pdf' }),
    ], NOW)
    expect(files.map(file => file.name)).toEqual([
      'screenshot-20261025-161830-1.png',
      'pasted-20261025-161830-2.pdf',
    ])
  })

  it('保留用户确实指定的文件名', () => {
    const original = new File(['a'], '年度总结.xlsx', { type: 'application/vnd.ms-excel' })
    const [file] = withPastedFileNames([original], NOW)
    expect(file).toBe(original)
  })
})

// 只实现 pastedFilesOf 用到的部分
function clipboard({ files = [], text = '', html = '' }: { files?: File[], text?: string, html?: string }) {
  return {
    files,
    items: [],
    getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
  } as unknown as DataTransfer
}

describe('pastedFilesOf', () => {
  const image = new File(['a'], 'image.png', { type: 'image/png' })

  it('截图与复制的图片按文件处理', () => {
    expect(pastedFilesOf(clipboard({ files: [image] }))).toEqual([image])
    // 浏览器「复制图片」会同时写入 <img> 的 HTML
    expect(pastedFilesOf(clipboard({ files: [image], html: '<img src="x.png">' }))).toEqual([image])
  })

  it('从文件管理器复制的文件附带文件名文字时仍按文件处理', () => {
    expect(pastedFilesOf(clipboard({ files: [image], text: 'image.png' }))).toEqual([image])
  })

  it('同时带文字和 HTML 的内容按文字粘贴', () => {
    expect(pastedFilesOf(clipboard({ files: [image], text: '单元格', html: '<table><td>单元格</td></table>' }))).toEqual([])
    expect(pastedFilesOf(clipboard({ text: 'hello' }))).toEqual([])
    expect(pastedFilesOf(null)).toEqual([])
  })
})
