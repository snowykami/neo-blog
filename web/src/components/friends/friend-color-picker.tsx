'use client'

import type { FriendColorKey } from '@/models/friend'
import { SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FRIEND_PALETTE_32, pickFriendColorFromSeed } from '@/models/friend'

export function FriendColorPicker({
  value,
  seedText,
  onChange,
}: {
  value: FriendColorKey
  seedText?: string
  onChange: (next: FriendColorKey) => void
}) {
  const t = useTranslations('Friends')

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onChange(pickFriendColorFromSeed(seedText?.trim() || String(Date.now())))}
        >
          <SparklesIcon className="size-3.5" />
          {t('match_color')}
        </Button>
      </div>
      <div
        role="radiogroup"
        aria-label={t('field_color')}
        className="grid grid-cols-8 gap-1.5 rounded-xl border bg-background p-2.5 sm:grid-cols-16"
      >
        {FRIEND_PALETTE_32.map(item => (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={value === item.key}
            title={item.key}
            onClick={() => onChange(item.key)}
            className={cn(
              'size-6 rounded-md border-2 border-transparent transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              value === item.key && 'scale-110 border-foreground ring-2 ring-card',
            )}
            style={{ backgroundColor: item.hex }}
          />
        ))}
      </div>
    </div>
  )
}
