import { useEffect, useRef, useState, useCallback } from "react"

/**
 * useDebouncedValue
 * 返回一个在指定 delay 毫秒后稳定下来的值。
 * 当输入频繁变化时，只在用户停止输入 delay 时间后才更新。
 */
export function useDebouncedValue<T>(value: T, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [value, delay])

  return debounced
}

/** 防抖回调：返回一个稳定函数，调用时会在 delay 后真正触发 cb（后触发覆盖先触发）。*/
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(cb: T, delay = 400) {
  const cbRef = useRef(cb)
  const timerRef = useRef<number | null>(null)
  cbRef.current = cb
  return (...args: Parameters<T>) => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      cbRef.current(...args)
    }, delay)
  }
}

interface UseDebouncedStateOptions {
  /** 是否在首次 set 时立即更新（默认 false 延迟） */
  immediate?: boolean
  /** 组件卸载时是否自动触发最后一次（默认 false） */
  flushOnUnmount?: boolean
}

/**
 * useDebouncedState
 * 返回: [state, setState, debouncedState, controls]
 * - state: 立即更新的本地值（用户输入实时）
 * - setState: 设定本地值并启动防抖计时，到期后同步到 debouncedState
 * - debouncedState: 稳定值（可用于副作用 / 请求）
 * - controls: { flush, cancel }
 */
export function useDebouncedState<T>(
  initial: T,
  delay = 400,
  options: UseDebouncedStateOptions = {}
) {
  const { immediate = false, flushOnUnmount = false } = options
  const [state, setState] = useState<T>(initial)
  const [debounced, setDebounced] = useState<T>(initial)
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<T>(initial)

  const flush = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setDebounced(pendingRef.current)
  }, [])

  const cancel = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const set = useCallback((val: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val
      pendingRef.current = next
      if (timerRef.current) window.clearTimeout(timerRef.current)
      if (immediate && debounced !== next && timerRef.current === null) {
        setDebounced(next)
      } else {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          setDebounced(pendingRef.current)
        }, delay)
      }
      return next
    })
  }, [delay, immediate, debounced])

  useEffect(() => () => {
    if (flushOnUnmount && timerRef.current) {
      flush()
    } else if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
  }, [flushOnUnmount, flush])

  return [state, set, debounced, { flush, cancel }] as const
}