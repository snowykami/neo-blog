/* eslint-disable next/no-img-element -- 预览的是本地 blob 地址，next/image 无法优化 */
'use client'

import type { KeyboardEvent, PointerEvent, ReactNode, SyntheticEvent } from 'react'
import type { CompressPreview } from '@/hooks/use-image-compress'
import { ChevronsLeftRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useObjectUrl } from '@/hooks/use-object-url'
import { useOperationT } from '@/hooks/use-translations'
import { cn } from '@/lib/utils'
import { COMPRESS_PRESETS } from '@/utils/client/image-compress'
import { formatDataSize } from '@/utils/common/datasize'
import { CompressLevelPicker } from './compress-level-picker'

// 各种状态共用同一个固定高度的画框，切换档位时布局不跳动
const FRAME_CLASS = 'relative h-[min(36dvh,440px)] overflow-hidden rounded-lg bg-muted/60 sm:h-[min(50dvh,440px)]'
const IMAGE_CLASS = 'pointer-events-none absolute inset-0 size-full object-contain'
const BADGE_CLASS = 'pointer-events-none absolute top-2 border-transparent bg-black/60 text-white'

interface PreviewSide {
  src: string
  label: string
  size: number
}

function naturalSize(e: SyntheticEvent<HTMLImageElement>) {
  return `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`
}

function sideCaption(side: PreviewSide, dimensions?: string) {
  return [side.label, formatDataSize({ size: side.size }), dimensions].filter(Boolean).join(' · ')
}

/**
 * 上传前预览压缩效果：拖动分隔线对比原图与压缩后的图片，并可在弹窗内直接切换档位
 */
export function CompressPreviewDialog({
  children,
  file,
  level,
  onLevelChange,
  preview,
}: {
  /** 触发器（asChild） */
  children: ReactNode
  file: File
  level: number
  onLevelChange: (level: number) => void
  preview: CompressPreview
}) {
  const t = useTranslations('ImageCompress')
  const operationT = useOperationT()
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('preview_title')}</DialogTitle>
          <DialogDescription className="break-all">{file.name}</DialogDescription>
        </DialogHeader>
        <CompressPreviewBody file={file} level={level} preview={preview} />
        <CompressLevelPicker value={level} onValueChange={onLevelChange} sizes={preview.sizesOf([file])} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">{operationT('confirm')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 弹窗内容：打开时才创建图片预览地址，关闭后释放 */
function CompressPreviewBody({ file, level, preview }: { file: File, level: number, preview: CompressPreview }) {
  const t = useTranslations('ImageCompress')
  const result = preview.resultOf(file, level)
  const compressed = result && result !== file ? result : null
  const originalUrl = useObjectUrl(file)
  const compressedUrl = useObjectUrl(compressed)
  const presetKey = COMPRESS_PRESETS.find(preset => preset.level === level)?.key ?? 'balanced'

  if (!originalUrl)
    return <div className={FRAME_CLASS} />

  const original: PreviewSide = { src: originalUrl, label: t('preset_original'), size: file.size }
  // 原图档或压缩后没有变小（按原图上传）时只展示原图
  if (level === 0 || result === file)
    return <SingleImage side={original} note={level > 0 ? t('preview_kept_original') : undefined} />
  if (!compressed || !compressedUrl) {
    return (
      <div className={cn(FRAME_CLASS, 'grid place-items-center')}>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {t('computing')}
        </span>
      </div>
    )
  }
  return (
    <ImageCompare
      before={original}
      after={{ src: compressedUrl, label: t(`preset_${presetKey}`), size: compressed.size }}
    />
  )
}

function SingleImage({ side, note }: { side: PreviewSide, note?: string }) {
  const [dimensions, setDimensions] = useState<string>()
  return (
    <div className="grid gap-2">
      <div className={FRAME_CLASS}>
        <img src={side.src} alt={side.label} draggable={false} className={IMAGE_CLASS} onLoad={e => setDimensions(naturalSize(e))} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">{sideCaption(side, dimensions)}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

const KEYBOARD_STEP = 5

/** 前后对比：左侧原图、右侧压缩后，拖动或用方向键移动分隔线 */
function ImageCompare({ before, after }: { before: PreviewSide, after: PreviewSide }) {
  const t = useTranslations('ImageCompress')
  const [position, setPosition] = useState(50)
  const [beforeDimensions, setBeforeDimensions] = useState<string>()
  const [afterDimensions, setAfterDimensions] = useState<string>()

  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPosition(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = {
      ArrowLeft: position - KEYBOARD_STEP,
      ArrowDown: position - KEYBOARD_STEP,
      ArrowRight: position + KEYBOARD_STEP,
      ArrowUp: position + KEYBOARD_STEP,
      Home: 0,
      End: 100,
    }[e.key]
    if (next === undefined)
      return
    e.preventDefault()
    setPosition(Math.min(100, Math.max(0, next)))
  }

  return (
    <div className="grid gap-2">
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('compare_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${Math.round(position)}%`}
        className={cn(FRAME_CLASS, 'cursor-ew-resize touch-none select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          moveTo(e)
        }}
        onPointerMove={e => e.currentTarget.hasPointerCapture(e.pointerId) && moveTo(e)}
        onKeyDown={handleKeyDown}
      >
        <img src={after.src} alt={after.label} draggable={false} className={IMAGE_CLASS} onLoad={e => setAfterDimensions(naturalSize(e))} />
        <img
          src={before.src}
          alt={before.label}
          draggable={false}
          className={IMAGE_CLASS}
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          onLoad={e => setBeforeDimensions(naturalSize(e))}
        />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" style={{ left: `${position}%` }}>
          <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-neutral-700 shadow-md">
            <ChevronsLeftRightIcon className="size-4" />
          </span>
        </div>
        <Badge className={cn(BADGE_CLASS, 'left-2')}>{before.label}</Badge>
        <Badge className={cn(BADGE_CLASS, 'right-2')}>{after.label}</Badge>
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{sideCaption(before, beforeDimensions)}</span>
        <span>{sideCaption(after, afterDimensions)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('compare_hint')}</p>
    </div>
  )
}
