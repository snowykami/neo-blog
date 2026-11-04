'use client'

import { useEffect, useState } from 'react'
import { useStoredState } from '@/hooks/use-storage-state'
import {
  COMPRESS_PRESETS,
  compressImage,
  DEFAULT_COMPRESS_LEVEL,
  peekCompressedImage,
  snapToCompressPreset,
} from '@/utils/client/image-compress'

const COMPRESS_LEVEL_STORAGE_KEY = 'neo-upload-compress-level'

/**
 * 上传图片的压缩等级：记住用户上次的选择，各上传入口共用；从未选择过时使用 fallback
 */
export function useCompressLevel(fallback = DEFAULT_COMPRESS_LEVEL) {
  const [stored, setStored] = useStoredState<number | null>(COMPRESS_LEVEL_STORAGE_KEY, null)
  return [snapToCompressPreset(stored ?? fallback), setStored] as const
}

export type CompressSizes = Record<number, number | undefined>

/**
 * 在后台预先压缩所选图片：当前档位优先，其余档位随后算好，切换档位时可立即看到体积和效果。
 * 结果按文件缓存，上传时直接复用
 */
export function useCompressPreview(files: readonly File[], level: number) {
  const [, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const levels = [level, ...COMPRESS_PRESETS.map(preset => preset.level).filter(other => other !== level)]
    void (async () => {
      // 逐个压缩，避免同时解码多张大图占用过多内存
      for (const current of levels) {
        for (const file of files) {
          if (cancelled)
            return
          if (peekCompressedImage(file, current))
            continue
          await compressImage(file, current)
          if (!cancelled)
            setVersion(version => version + 1)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [files, level])

  /** 文件在指定档位（默认当前档位）下的上传结果，尚未压缩完成时为 undefined */
  const resultOf = (file: File, at = level) => peekCompressedImage(file, at)

  /** 各档位下这些文件的总体积，有文件尚未压缩完成的档位为 undefined；没有文件时返回 undefined */
  const sizesOf = (targets: readonly File[]): CompressSizes | undefined => {
    if (targets.length === 0)
      return undefined
    return Object.fromEntries(COMPRESS_PRESETS.map(({ level: at }) => {
      let total = 0
      for (const file of targets) {
        const result = peekCompressedImage(file, at)
        if (!result)
          return [at, undefined]
        total += result.size
      }
      return [at, total]
    }))
  }

  return { resultOf, sizesOf }
}

export type CompressPreview = ReturnType<typeof useCompressPreview>
