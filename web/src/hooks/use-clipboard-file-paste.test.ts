import { describe, expect, it } from 'vitest'
import { withPastedFileNames } from './use-clipboard-file-paste'

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
