'use client'

import type { ToasterProps } from 'sonner'
import { Toaster as Sonner } from 'sonner'
import { useDevice } from '@/contexts/device-context'

function Toaster({ ...props }: ToasterProps) {
  // 项目未使用 next-themes，主题状态来自 DeviceProvider
  const { mode } = useDevice()

  return (
    <Sonner
      theme={mode}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
