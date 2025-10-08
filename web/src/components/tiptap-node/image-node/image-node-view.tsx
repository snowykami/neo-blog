import type { Editor, NodeViewProps } from "@tiptap/react"
import { NodeViewWrapper } from "@tiptap/react"
import { useCallback, useEffect, useRef, useState } from "react"
import * as React from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import "./image-node-view.scss"

export interface ResizeParams {
  handleUsed: "left" | "right" | "corner"
  initialWidth: number
  initialClientX: number
  initialClientY: number
}

export interface ResizableImageProps
  extends React.HTMLAttributes<HTMLDivElement> {
  src: string
  alt?: string
  editor?: Editor
  minWidth?: number
  maxWidth?: number
  align?: "left" | "center" | "right"
  initialWidth?: number
  onImageResize?: (width?: number) => void
}

export function ImageNodeView(props: NodeViewProps) {
  const { editor, node, updateAttributes } = props

  return (
    <ResizableImage
      src={node.attrs.src}
      alt={node.attrs.alt || ""}
      editor={editor}
      align={node.attrs["data-align"]}
      initialWidth={node.attrs.width}
      onImageResize={(width) => updateAttributes({ width })}
    />
  )
}

function createPointerCaptureOverlay(
  onMove: (ev: PointerEvent) => void,
  onUp: (ev: PointerEvent) => void
) {
  const overlay = document.createElement("div")
  overlay.style.position = "fixed"
  overlay.style.inset = "0"
  overlay.style.zIndex = "999999"
  overlay.style.background = "transparent"
  overlay.style.touchAction = "none" // 非常重要：阻止浏览器手势拦截
  document.body.appendChild(overlay)

  const moveHandler = (e: PointerEvent) => {
    e.preventDefault()
    onMove(e)
  }
  const upHandler = (e: PointerEvent) => {
    onUp(e)
  }

  overlay.addEventListener("pointermove", moveHandler, { passive: false })
  overlay.addEventListener("pointerup", upHandler)
  overlay.addEventListener("pointercancel", upHandler)

  return () => {
    overlay.removeEventListener("pointermove", moveHandler)
    overlay.removeEventListener("pointerup", upHandler)
    overlay.removeEventListener("pointercancel", upHandler)
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
  }
}

export const ResizableImage: React.FC<ResizableImageProps> = ({
  src,
  alt = "",
  editor,
  minWidth = 96,
  maxWidth = 800,
  align = "left",
  initialWidth,
  onImageResize,
}) => {
  const isMobile = useIsMobile()
  const [resizeParams, setResizeParams] = useState<ResizeParams | undefined>(
    undefined
  )
  const [width, setWidth] = useState<number | undefined>(initialWidth)
  const [showHandles, setShowHandles] = useState<boolean>(false)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const leftResizeHandleRef = useRef<HTMLDivElement>(null)
  const rightResizeHandleRef = useRef<HTMLDivElement>(null)
  const cornerResizeHandleRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const activeOverlayCleanupRef = useRef<(() => void) | null>(null)

  // 使用 PointerEvent 支持触摸与鼠标
  const windowPointerMoveHandler = React.useCallback(
    (event: PointerEvent): void => {
      if (!resizeParams || !editor) {
        return
      }

      let newWidth: number

      if (resizeParams.handleUsed === "corner") {
        // Mobile corner resize: diagonal drag
        const deltaX = event.clientX - resizeParams.initialClientX
        const deltaY = event.clientY - resizeParams.initialClientY
        // Use the larger of the two deltas for more intuitive resize
        const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY
        
        if (align === "center") {
          newWidth = resizeParams.initialWidth + delta * 2
        } else {
          newWidth = resizeParams.initialWidth + delta
        }
      } else if (align === "center") {
        if (resizeParams.handleUsed === "left") {
          newWidth =
            resizeParams.initialWidth +
            (resizeParams.initialClientX - event.clientX) * 2
        } else {
          newWidth =
            resizeParams.initialWidth +
            (event.clientX - resizeParams.initialClientX) * 2
        }
      } else {
        if (resizeParams.handleUsed === "left") {
          newWidth =
            resizeParams.initialWidth +
            resizeParams.initialClientX -
            event.clientX
        } else {
          newWidth =
            resizeParams.initialWidth +
            event.clientX -
            resizeParams.initialClientX
        }
      }

      const effectiveMinWidth = minWidth
      const effectiveMaxWidth =
        editor.view.dom?.firstElementChild?.clientWidth || maxWidth

      const newCalculatedWidth = Math.min(
        Math.max(newWidth, effectiveMinWidth),
        effectiveMaxWidth
      )

      setWidth(newCalculatedWidth)
      if (wrapperRef.current) {
        wrapperRef.current.style.width = `${newCalculatedWidth}px`
      }
    },
    [editor, align, maxWidth, minWidth, resizeParams]
  )

  const windowPointerUpHandler = React.useCallback(
    (event: PointerEvent): void => {
      if (activePointerIdRef.current != null) {
        try {
          leftResizeHandleRef.current?.releasePointerCapture?.(activePointerIdRef.current)
          rightResizeHandleRef.current?.releasePointerCapture?.(activePointerIdRef.current)
          cornerResizeHandleRef.current?.releasePointerCapture?.(activePointerIdRef.current)
        } catch {}
        activePointerIdRef.current = null
      }
      if (!editor) {
        return
      }

      if (
        (!event.target ||
          !wrapperRef.current?.contains(event.target as Node) ||
          !editor.isEditable) &&
        showHandles
      ) {
        setShowHandles(false)
      }

      if (!resizeParams) {
        return
      }

      setResizeParams(undefined)

      if (onImageResize) {
        onImageResize(width)
      }
    },
    [editor, showHandles, resizeParams, onImageResize, width]
  )

  const onPointerMoveGlobal = useCallback(
    (e: PointerEvent) => {
      // 复用现有计算逻辑：把 PointerEvent 转给原来的 windowPointerMoveHandler 实现
      // 假设你已有一个函数 windowPointerMoveHandler 接受 PointerEvent
      windowPointerMoveHandler(e)
    },
    [windowPointerMoveHandler]
  )

  const onPointerUpGlobal = useCallback(
    (e: PointerEvent) => {
      // 结束拖拽：释放捕获、清 overlay、调用原本的 up handler
      if (activeOverlayCleanupRef.current) {
        activeOverlayCleanupRef.current()
        activeOverlayCleanupRef.current = null
      }
      windowPointerUpHandler(e)
    },
    [windowPointerUpHandler]
  )

  const leftResizeHandlePointerDownHandler = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    event.preventDefault()
    // 尝试在目标上 setPointerCapture（兼容桌面）
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId)
    } catch {}
    // 创建全屏 overlay 捕获后续 pointermove/pointerup（确保移动端不会被系统抢夺）
    if (typeof window !== "undefined") {
      // cleanup 上一个 overlay（防御性）
      activeOverlayCleanupRef.current?.()
      activeOverlayCleanupRef.current = createPointerCaptureOverlay(
        onPointerMoveGlobal,
        onPointerUpGlobal
      )
    }

    setResizeParams({
      handleUsed: "left",
      initialWidth: wrapperRef.current?.clientWidth || Number.MAX_VALUE,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
    })
  }

  const rightResizeHandlePointerDownHandler = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    event.preventDefault()
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId)
    } catch {}
    if (typeof window !== "undefined") {
      activeOverlayCleanupRef.current?.()
      activeOverlayCleanupRef.current = createPointerCaptureOverlay(
        onPointerMoveGlobal,
        onPointerUpGlobal
      )
    }

    setResizeParams({
      handleUsed: "right",
      initialWidth: wrapperRef.current?.clientWidth || Number.MAX_VALUE,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
    })
  }

  const cornerResizeHandlePointerDownHandler = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    event.preventDefault()
    try {
      (event.target as Element).setPointerCapture?.(event.pointerId)
    } catch {}
    if (typeof window !== "undefined") {
      activeOverlayCleanupRef.current?.()
      activeOverlayCleanupRef.current = createPointerCaptureOverlay(
        onPointerMoveGlobal,
        onPointerUpGlobal
      )
    }

    setResizeParams({
      handleUsed: "corner",
      initialWidth: wrapperRef.current?.clientWidth || Number.MAX_VALUE,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
    })
  }

  const wrapperPointerEnterHandler = (): void => {
    if (editor && editor.isEditable) {
      setShowHandles(true)
    }
  }

  const wrapperPointerLeaveHandler = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    if (
      event.relatedTarget === leftResizeHandleRef.current ||
      event.relatedTarget === rightResizeHandleRef.current
    ) {
      return
    }

    if (resizeParams) {
      return
    }

    if (editor && editor.isEditable) {
      setShowHandles(false)
    }
  }

  // 在组件卸载或 pointerup 全局清理 overlay
  useEffect(() => {
    return () => {
      activeOverlayCleanupRef.current?.()
      activeOverlayCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    // pointer events cover mouse + touch + pen
    window.addEventListener("pointermove", windowPointerMoveHandler, {
      passive: false,
    })
    window.addEventListener("pointerup", windowPointerUpHandler)

    return () => {
      window.removeEventListener("pointermove", windowPointerMoveHandler)
      window.removeEventListener("pointerup", windowPointerUpHandler)
    }
  }, [windowPointerMoveHandler, windowPointerUpHandler])

  return (
    <NodeViewWrapper
      onPointerEnter={wrapperPointerEnterHandler}
      onPointerLeave={wrapperPointerLeaveHandler}
      onClick={() => {
        // 点击也显示句柄，方便触摸设备操作
        if (editor && editor.isEditable) setShowHandles(true)
      }}
      data-align={align}
      data-width={width}
      className="tiptap-image"
      contentEditable={false}
    >
      <div
        ref={wrapperRef}
        className="tiptap-image-container"
        style={{
          width: width ? `${width}px` : "fit-content",
        }}
      >
        <div className="tiptap-image-content">
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            className="tiptap-image-img"
            contentEditable={false}
            draggable={false}
          />

          {showHandles && editor && editor.isEditable && (
            <>
              {!isMobile ? (
                // PC mode: left and right handles
                <>
                  <div
                    ref={leftResizeHandleRef}
                    className="tiptap-image-handle tiptap-image-handle-left"
                    onPointerDown={leftResizeHandlePointerDownHandler}
                  />
                  <div
                    ref={rightResizeHandleRef}
                    className="tiptap-image-handle tiptap-image-handle-right"
                    onPointerDown={rightResizeHandlePointerDownHandler}
                  />
                </>
              ) : (
                // Mobile mode: corner handle
                <div
                  ref={cornerResizeHandleRef}
                  className="tiptap-image-handle tiptap-image-handle-corner"
                  onPointerDown={cornerResizeHandlePointerDownHandler}
                />
              )}
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
