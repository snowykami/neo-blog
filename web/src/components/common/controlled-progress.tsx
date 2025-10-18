'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'

interface Props {
  value: number // 0..100
  onChange: (v: number) => void // 实时变化（拖动/点击）
  onChangeEnd?: (v: number) => void // 释放时回调
  disabled?: boolean
  step?: number // 键盘步进（百分比）
  className?: string
  onIsDraggingChange?: (isDragging: boolean) => void
}

export function ProgressControl({
  value,
  onChange,
  onChangeEnd,
  disabled = false,
  step = 1,
  className = '',
  onIsDraggingChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const startXRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const [local, setLocal] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const THRESHOLD_PX = 5 // 超过多少像素才认为是拖动

  useEffect(() => {
    if (onIsDraggingChange) {
      onIsDraggingChange(isDragging)
    }
  }, [isDragging, onIsDraggingChange])

  const clientXToPercent = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el)
      return 0
    const rect = el.getBoundingClientRect()
    const p = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(1, p))
  }, [])

  const scheduleUpdate = useCallback((v: number) => {
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(() => {
        setLocal(v)
        onChange(v)
        rafIdRef.current = null
      })
    }
  }, [onChange])

  // 把这些改成函数声明，避免 eslint no-use-before-define
  function onWindowPointerMove(ev: PointerEvent) {
    if (pointerIdRef.current != null && ev.pointerId !== pointerIdRef.current)
      return
    const clientX = ev.clientX
    const startX = startXRef.current
    if (startX == null)
      return
    const dx = Math.abs(clientX - startX)

    // 未到拖动阈值：当超过阈值才进入 dragging 状态
    if (!draggingRef.current) {
      if (dx >= THRESHOLD_PX) {
        draggingRef.current = true
        setIsDragging(true)
      }
      else {
        return
      }
    }

    // 已为拖动状态，持续更新
    const pct = clientXToPercent(clientX)
    const v = Math.round(pct * 10000) / 100
    scheduleUpdate(v)
  }

  function onWindowPointerUp(ev: PointerEvent) {
    if (pointerIdRef.current != null && ev.pointerId !== pointerIdRef.current)
      return
    const clientX = ev.clientX
    const pct = clientXToPercent(clientX)
    const v = Math.round(pct * 10000) / 100

    // 如果是拖动结束，或者只是点击（未进入 dragging）都要触发结束回调
    setLocal(null)
    // 只有当真正拖动过或点击结束时才把最终值提交给父
    onChange(v)
    onChangeEnd?.(v)

    // reset
    draggingRef.current = false
    setIsDragging(false)
    startXRef.current = null
    pointerIdRef.current = null
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    cleanupPointerListeners()
  }

  // 使用函数声明，避免 "used before defined" 的 eslint 报错
  function cleanupPointerListeners() {
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerup', onWindowPointerUp)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled)
      return
    const el = e.currentTarget
    el.setPointerCapture?.(e.pointerId)
    pointerIdRef.current = e.pointerId
    startXRef.current = e.clientX
    // 这里把当前点击位置作为一次瞬时显示更新，但不立即把值强制传给父（避免受控闪烁）
    const pct = clientXToPercent(e.clientX)
    const v = Math.round(pct * 10000) / 100
    setLocal(v)
    // 不直接调用 onChange，等待真正的拖动或 pointerup 调用

    // 监听全局 move/up，实际是否进入 dragging 由 move 判定
    window.addEventListener('pointermove', onWindowPointerMove)
    window.addEventListener('pointerup', onWindowPointerUp)
  }

  useEffect(() => {
    return () => {
      // 清理全局监听与 rAF
      cleanupPointerListeners()
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, []) // 仅在卸载时执行

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled)
      return
    let next = value
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      next = Math.max(0, value - step)
      e.preventDefault()
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      next = Math.min(100, value + step)
      e.preventDefault()
    }
    else if (e.key === 'Home') {
      next = 0
      e.preventDefault()
    }
    else if (e.key === 'End') {
      next = 100
      e.preventDefault()
    }
    else {
      return
    }
    onChange(next)
    onChangeEnd?.(next)
  }

  const display = local != null ? local : value
  const percent = Math.max(0, Math.min(100, Number(display) || 0))

  return (
    <div className={`w-full ${className}`}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className={`touch-none select-none ${disabled ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
      >
        <Progress value={percent} />
      </div>
    </div>
  )
}
