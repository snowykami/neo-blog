import { useRef, useState } from 'react'

export function useDoubleConfirm(timeout = 2000) {
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const onClick = (callback: () => void) => {
    if (confirming) {
      setConfirming(false)
      if (timer.current)
        clearTimeout(timer.current)
      callback()
    }
    else {
      setConfirming(true)
      timer.current = setTimeout(() => setConfirming(false), timeout)
    }
  }

  // 可选：失焦时自动取消
  const onBlur = () => {
    setConfirming(false)
    if (timer.current)
      clearTimeout(timer.current)
  }

  return { confirming, onClick, onBlur }
}
