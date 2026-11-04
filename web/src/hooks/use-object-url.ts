'use client'

import { useEffect, useState } from 'react'

/** 为本地文件创建预览地址，文件变化或组件卸载时释放 */
export function useObjectUrl(file: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return url
}
