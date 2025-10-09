'use client'
import type { Crop } from 'react-image-crop'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactCrop from 'react-image-crop'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useOperationT } from '@/hooks/translations'
import 'react-image-crop/dist/ReactCrop.css'

export function ImageCropper({
  image,
  onCropped,
  onCancel,
  initialAspect = 1.0,
  lockAspect = false,
}: {
  image: File | Blob | null
  onCropped: (blob: Blob) => void
  onCancel?: () => void
  initialAspect?: number
  lockAspect?: boolean
}) {
  const operationT = useOperationT()
  const t = useTranslations('Components.image_cropper')
  const normalizeAspect = (a: number | undefined) => {
    const v = typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : 1.0
    return v
  }

  const computeInitialCrop = (aspect: number): Partial<Crop> => {
    // use percent units for initial crop and center it
    let w = 50
    let h = w / aspect

    if (h > 100) {
      h = 100
      w = Math.min(100, 100 * aspect)
    }
    if (w > 100) {
      w = 100
      h = Math.min(100, w / aspect)
    }

    const x = Math.max(0, (100 - w) / 2)
    const y = Math.max(0, (100 - h) / 2)

    return {
      unit: '%',
      x,
      y,
      width: w,
      height: h,
    }
  }

  const [crop, setCrop] = useState<Partial<Crop>>(() =>
    computeInitialCrop(normalizeAspect(initialAspect)),
  )

  const [imageSrc, setImageSrc] = useState<string>('')
  const [open, setOpen] = useState<boolean>(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    // 清理旧的 objectURL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    if (!image) {
      setImageSrc('')
      return
    }

    if (typeof image === 'string') {
      setImageSrc(image)
      return
    }

    try {
      const url = URL.createObjectURL(image as Blob)
      objectUrlRef.current = url
      setImageSrc(url)
    }
    catch (err) {
      console.error('createObjectURL failed', err)
      setImageSrc('')
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [image])

  // If initialAspect or lockAspect changes while mounted, optionally update crop to match new aspect
  useEffect(() => {
    const aspect = normalizeAspect(initialAspect)
    if (lockAspect) {
      setCrop((c) => {
        // try to preserve width and center; fallback to computed initial crop
        const width = typeof c.width === 'number' ? c.width : 50
        let height = width / aspect
        let w = width
        if (height > 100) {
          height = 100
          w = Math.min(100, 100 * aspect)
        }
        if (w > 100) {
          w = 100
          height = Math.min(100, w / aspect)
        }
        const x = Math.max(0, (100 - w) / 2)
        const y = Math.max(0, (100 - height) / 2)
        return { ...(c ?? {}), unit: '%', width: w, height, x, y }
      })
    }
    else {
      // when unlocking, keep current crop as-is; no change required
    }
    // only respond to changes of initialAspect or lockAspect
  }, [initialAspect, lockAspect])

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget
  }, [])

  const getCroppedBlob = useCallback(async (): Promise<Blob | null> => {
    const img = imgRef.current
    if (!img || !crop)
      return null

    // 计算渲染像素上的裁剪区域（支持 '%' 或 'px'）
    const unitIsPercent = (crop.unit ?? '%') === '%'
    const renderWidth = img.width
    const renderHeight = img.height

    const sxRender = unitIsPercent ? ((crop.x ?? 0) / 100) * renderWidth : (crop.x ?? 0)
    const syRender = unitIsPercent ? ((crop.y ?? 0) / 100) * renderHeight : (crop.y ?? 0)
    const swRender = unitIsPercent ? ((crop.width ?? 0) / 100) * renderWidth : (crop.width ?? 0)
    const shRender = unitIsPercent ? ((crop.height ?? 0) / 100) * renderHeight : (crop.height ?? 0)

    // 把渲染像素坐标映射到原始图片像素（naturalWidth/naturalHeight）
    const scaleX = img.naturalWidth / renderWidth
    const scaleY = img.naturalHeight / renderHeight
    const sx = Math.round(sxRender * scaleX)
    const sy = Math.round(syRender * scaleY)
    const sw = Math.max(1, Math.round(swRender * scaleX))
    const sh = Math.max(1, Math.round(shRender * scaleY))

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return null
    ctx.clearRect(0, 0, sw, sh)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(b => resolve(b), 'image/png', 0.95)
    })
  }, [crop])

  const handleClose = () => {
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen && onCancel)
          onCancel()
      }}
    >
      <div onSubmit={e => e.preventDefault()}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            disabled={!image}
            className={!image ? 'opacity-50 cursor-not-allowed' : ''}
          >
            {operationT('edit')}
          </Button>
        </DialogTrigger>

        {image && (
          <DialogContent className="sm:max-w-[425px]">
            <DialogTitle className="text-lg font-medium mb-2">{t('crop_image')}</DialogTitle>
            <div className="w-full h-[360px] bg-gray-100 flex items-center justify-center overflow-auto">
              {imageSrc
                ? (
                    <ReactCrop
                      crop={crop as Crop}
                      onChange={c => setCrop(c)}
                      aspect={lockAspect ? normalizeAspect(initialAspect) : undefined}
                    >
                      {/* 必须用原生 img 元素 */}
                      <Image
                        src={imageSrc}
                        alt="source"
                        onLoad={onImageLoad}
                        width={640}
                        height={640}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '60vh',
                          display: 'block',
                        }}
                      />
                    </ReactCrop>
                  )
                : (
                    <div className="text-sm text-muted-foreground">{t('no_image_to_crop')}</div>
                  )}
            </div>

            <div className="flex items-center gap-4 mt-4">
              <div className="flex-1">
                <Label>{operationT('preview')}</Label>
                <div className="w-32 h-32 border bg-white overflow-hidden">
                  {/* 临时预览：把裁剪结果画到 canvas 并显示 */}
                  <PreviewCanvas crop={crop} imgRef={imgRef} />
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" type="button" onClick={handleClose}>
                {operationT('cancel')}
              </Button>
              <Button
                type="button"
                onClick={async () => {
                  const blob = await getCroppedBlob()
                  if (blob) {
                    onCropped(blob)
                    handleClose()
                  }
                }}
              >
                确认
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </div>
    </Dialog>
  )
}

// 简单的预览 canvas 组件（显示当前裁剪区域）
function PreviewCanvas({
  crop,
  imgRef,
  aspect,
}: {
  crop: Partial<Crop>
  imgRef: React.RefObject<HTMLImageElement | null>
  aspect?: number // width / height
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas || !crop)
      return

    const unitIsPercent = (crop.unit ?? '%') === '%'
    const renderWidth = img.width
    const renderHeight = img.height

    const sxRender = unitIsPercent ? ((crop.x ?? 0) / 100) * renderWidth : (crop.x ?? 0)
    const syRender = unitIsPercent ? ((crop.y ?? 0) / 100) * renderHeight : (crop.y ?? 0)
    const swRender = unitIsPercent ? ((crop.width ?? 0) / 100) * renderWidth : (crop.width ?? 0)
    const shRender = unitIsPercent ? ((crop.height ?? 0) / 100) * renderHeight : (crop.height ?? 0)

    const scaleX = img.naturalWidth / renderWidth
    const scaleY = img.naturalHeight / renderHeight
    const sx = Math.round(sxRender * scaleX)
    const sy = Math.round(syRender * scaleY)
    const sw = Math.max(1, Math.round(swRender * scaleX))
    const sh = Math.max(1, Math.round(shRender * scaleY))

    // container available size (CSS pixels)
    const parent = canvas.parentElement
    const availW = parent?.clientWidth ?? 128
    const availH = parent?.clientHeight ?? 128

    // Start with keeping height constant (availH). Compute desired width from aspect.
    // If no aspect provided or invalid, use source region aspect (sw/sh).
    const srcAspect = sw > 0 && sh > 0 ? sw / sh : 1
    const asp
      = typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? aspect : srcAspect

    let outH = Math.max(1, availH)
    let outW = Math.max(1, Math.round(asp * outH))

    // If width exceeds available width, scale down to fit; recalc height to preserve aspect.
    if (outW > availW) {
      outW = availW
      outH = Math.max(1, Math.round(outW / asp))
    }
    // If height somehow exceeds available height (guard), scale down.
    if (outH > availH) {
      outH = availH
      outW = Math.max(1, Math.round(outH * asp))
    }

    // handle device pixel ratio for crisp rendering
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = outW * dpr
    canvas.height = outH * dpr
    canvas.style.width = `${outW}px`
    canvas.style.height = `${outH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // scale drawing operations
    ctx.clearRect(0, 0, outW, outH)
    // draw the selected natural-pixel region into the output size
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  }, [crop, imgRef, aspect])

  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}
