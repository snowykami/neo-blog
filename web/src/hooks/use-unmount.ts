import { useEffect, useRef } from 'react'

/**
 * Hook that executes a callback when the component unmounts.
 *
 * @param callback Function to be called on component unmount
 */
export function useUnmount(callback: (...args: Array<any>) => any) {
  const ref = useRef(callback)
  ref.current = callback

  useEffect(
    () => () => {
      ref.current()
    },
    [],
  )
}

export default useUnmount
