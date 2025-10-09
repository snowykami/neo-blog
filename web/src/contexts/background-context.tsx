import React, { createContext, useCallback, useContext, useState } from 'react'

interface BackgroundContextType {
  background: React.ReactNode
  setBackground: (bg: React.ReactNode) => void
  resetBackground: () => void
}

const BackgroundContext = createContext<BackgroundContextType | undefined>(undefined)

export const BackgroundProvider: React.FC<{ children: React.ReactNode, defaultBackground?: React.ReactNode }> = ({
  children,
  defaultBackground = null,
}) => {
  const [background, setBackgroundState] = useState<React.ReactNode>(defaultBackground)

  const setBackground = useCallback((bg: React.ReactNode) => {
    setBackgroundState(bg)
  }, [])

  const resetBackground = useCallback(() => {
    setBackgroundState(defaultBackground)
  }, [defaultBackground])

  return (
    <BackgroundContext.Provider value={{ background, setBackground, resetBackground }}>
      {/* 背景节点自动渲染在 children 之下 */}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {background && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            {background}
          </div>
        )}
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      </div>
    </BackgroundContext.Provider>
  )
}

export function useBackground() {
  const ctx = useContext(BackgroundContext)
  if (!ctx)
    throw new Error('useBackground must be used within a BackgroundProvider')
  return ctx
}

// 便于直接解构使用
export const backgroundContext = {
  useBackground,
  BackgroundProvider,
}
