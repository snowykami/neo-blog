'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { updateUser } from '@/api/user'
import { useAuth } from '@/contexts/auth-context'
import { ColorSchemeSelector } from '../common/color-scheme-selector'

export function UserPreferencePage() {
  const t = useTranslations('Console.user_preference')
  const { user } = useAuth()
  const [color, setColor] = useState<string | null>(user?.preferredColor || null)

  useEffect(() => {
    if (!color)
      return
    const previousColor = user?.preferredColor
    if (typeof window !== 'undefined') {
      document.documentElement.setAttribute('data-user-color', color)
    }
    updateUser({ id: user?.id, preferredColor: color })
      .catch((error) => {
        if (typeof window !== 'undefined') {
          document.documentElement.setAttribute('data-user-color', previousColor || 'blue')
        }
        setColor(previousColor || null)
        toast.error('Failed to update color scheme', { description: error.message })
      })
  }, [color, user?.id, user?.preferredColor])

  const onColorChange = useCallback((color: string) => {
    setColor(color)
  }, [])

  return (
    <div>
      <div className="grid w-full items-center gap-4">
        <h1 className="text-2xl font-bold">
          {t('title')}
        </h1>
        <div className="grid gap-2">
          <h2 className="text">{t('color_scheme')}</h2>
          {user && <ColorSchemeSelector color={color} onColorChange={onColorChange} />}
        </div>
      </div>
    </div>
  )
}
