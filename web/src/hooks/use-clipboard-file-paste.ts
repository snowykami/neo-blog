'use client'

import mime from 'mime-types'
import { useEffect, useRef } from 'react'

/** 判断粘贴目标是否可编辑，可编辑时不接管，避免影响正常的文本粘贴 */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false
  if (target.isContentEditable)
    return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/** 从剪贴板数据中取出文件（截图、从文件管理器复制的文件等） */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data)
    return []
  const files = Array.from(data.files ?? [])
  if (files.length > 0)
    return files
  // 部分浏览器复制文件时只写 items，不写 files
  return Array.from(data.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/** 剪贴板里的图片往往只有 image.png / blob 这类无意义的名字，重命名成带时间戳的可读名字 */
function isGenericName(name: string) {
  return !name.trim() || /^(?:image|blob|clipboard|pasted|unknown|file)(?:[-_ ]?\d+)?(?:\.[\w-]+)?$/i.test(name.trim())
}

function timestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${ymd}-${hms}`
}

/** 给粘贴进来的文件起名，保留用户确有指定的文件名 */
export function withPastedFileNames(files: File[], now = new Date()): File[] {
  const stamp = timestamp(now)
  return files.map((file, index) => {
    if (!isGenericName(file.name))
      return file
    const ext = file.name.includes('.')
      ? file.name.split('.').pop()
      : (mime.extension(file.type) || 'bin')
    const base = file.type.startsWith('image/') ? 'screenshot' : 'pasted'
    const suffix = files.length > 1 ? `-${index + 1}` : ''
    return new File([file], `${base}-${stamp}${suffix}.${ext}`, { type: file.type, lastModified: file.lastModified })
  })
}

/**
 * 监听当前文档的粘贴事件，把剪贴板中的文件交给 onFiles（如直接粘贴截图上传）。
 * enabled 为 false 时不监听，通常与弹层打开状态绑定，避免在页面其他位置误触发。
 */
export function useClipboardFilePaste({
  enabled = true,
  onFiles,
}: {
  enabled?: boolean
  onFiles: (files: File[]) => void
}) {
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles

  useEffect(() => {
    if (!enabled)
      return
    const handlePaste = (event: ClipboardEvent) => {
      // 在输入框 / 富文本里粘贴时保持默认行为
      if (isEditableTarget(event.target))
        return
      const files = filesFromClipboard(event.clipboardData)
      if (files.length === 0)
        return
      // 剪贴板同时带有纯文本时（如从网页、Word 复制）不把内容当文件处理
      if (event.clipboardData?.getData('text/plain').trim())
        return
      event.preventDefault()
      onFilesRef.current(withPastedFileNames(files))
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [enabled])
}
