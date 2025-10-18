import { useCallback, useEffect, useState } from 'react'

export function useStoredState<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        try {
          setValue(JSON.parse(stored))
        }
        catch {
          setValue(stored as T)
        }
      }
    }
    catch (error) {
      console.error('Error reading from localStorage:', error)
    }
    finally {
      setIsLoaded(true)
    }
  }, [key])

  // 使用 useCallback 确保 setter 函数引用稳定
  const setStoredValue = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const valueToStore = typeof newValue === 'function'
          ? (newValue as (prev: T) => T)(prev)
          : newValue

        try {
          localStorage.setItem(
            key,
            typeof valueToStore === 'string' ? valueToStore : JSON.stringify(valueToStore),
          )
        }
        catch (error) {
          console.error('Error writing to localStorage:', error)
        }

        return valueToStore
      })
    },
    [key],
  )

  return [value, setStoredValue, isLoaded] as const
}
